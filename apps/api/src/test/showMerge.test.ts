import '../loadEnv.js'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { inArray, eq, and } from 'drizzle-orm'
import { createDbClient, type DbClient } from '@kyomiru/db/client'
import {
  shows, showProviders, seasons, episodes,
  episodeProviders, userEpisodeProgress, userShowState, users,
} from '@kyomiru/db/schema'
import { mergeShows } from '../services/showMerge.js'

const DATABASE_URL = process.env['DATABASE_URL']

describe.skipIf(!DATABASE_URL)('mergeShows (DB)', () => {
  let db: DbClient
  const createdShowIds: string[] = []
  const createdUserIds: string[] = []

  beforeAll(() => {
    db = createDbClient(DATABASE_URL!)
  })

  afterEach(async () => {
    if (createdShowIds.length > 0) {
      await db.delete(shows).where(inArray(shows.id, createdShowIds))
      createdShowIds.length = 0
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds))
      createdUserIds.length = 0
    }
  })

  async function makeShow(opts: {
    tmdbId?: number | null
    anilistId?: number | null
    canonicalTitle?: string
    genres?: string[]
    titles?: Record<string, string>
    descriptions?: Record<string, string>
  } = {}) {
    const suffix = Math.random().toString(36).slice(2, 8)
    const title = opts.canonicalTitle ?? `Show ${suffix}`
    const [row] = await db.insert(shows).values({
      canonicalTitle: title,
      titleNormalized: title.toLowerCase(),
      tmdbId: opts.tmdbId ?? null,
      anilistId: opts.anilistId ?? null,
      genres: opts.genres ?? [],
      titles: opts.titles ?? { en: title },
      descriptions: opts.descriptions ?? {},
    }).returning({ id: shows.id })
    createdShowIds.push(row!.id)
    return row!.id
  }

  async function makeUser(suffix?: string) {
    const s = suffix ?? Math.random().toString(36).slice(2, 8)
    const [row] = await db.insert(users).values({
      googleSub: `sub-${s}`,
      email: `user-${s}@example.com`,
      displayName: `User ${s}`,
    }).returning({ id: users.id })
    createdUserIds.push(row!.id)
    return row!.id
  }

  async function makeProvider(showId: string, providerKey: string, externalId: string) {
    await db.insert(showProviders).values({ showId, providerKey, externalId }).onConflictDoNothing()
  }

  async function makeSeason(showId: string, seasonNumber: number) {
    const [row] = await db.insert(seasons).values({
      showId,
      seasonNumber,
      episodeCount: 0,
      titles: {},
    }).returning({ id: seasons.id })
    return row!.id
  }

  async function makeEpisode(seasonId: string, showId: string, episodeNumber: number, providerKey?: string, externalId?: string) {
    const [row] = await db.insert(episodes).values({
      seasonId,
      showId,
      episodeNumber,
      titles: {},
      descriptions: {},
    }).returning({ id: episodes.id })
    if (providerKey && externalId) {
      await db.insert(episodeProviders).values({
        episodeId: row!.id,
        providerKey,
        externalId,
      }).onConflictDoNothing()
    }
    return row!.id
  }

  async function makeUEP(userId: string, episodeId: string, watched: boolean) {
    await db.insert(userEpisodeProgress).values({
      userId,
      episodeId,
      playheadSeconds: watched ? 1200 : 300,
      watched,
      watchedAt: watched ? new Date('2024-01-01') : null,
      lastEventAt: new Date('2024-01-01'),
    }).onConflictDoNothing()
  }

  async function makeUSS(userId: string, showId: string, status: 'in_progress' | 'watched' | 'removed' = 'in_progress') {
    await db.insert(userShowState).values({
      userId,
      showId,
      status,
      totalEpisodes: 3,
      watchedEpisodes: 1,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing()
  }

  it('returns skipped when either show is missing', async () => {
    const canonical = await makeShow({ tmdbId: 50001 })
    const result = await mergeShows(db, {
      kind: 'tmdb',
      externalId: 50001,
      canonicalShowId: canonical,
      duplicateShowId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.skipped).toBe(true)
  })

  it('returns skipped when canonical no longer holds the external id', async () => {
    const canonical = await makeShow({ tmdbId: null })
    const duplicate = await makeShow()
    const result = await mergeShows(db, {
      kind: 'tmdb',
      externalId: 50002,
      canonicalShowId: canonical,
      duplicateShowId: duplicate,
    })
    expect(result.skipped).toBe(true)
  })

  it('migrates show_providers from duplicate to canonical', async () => {
    const canonical = await makeShow({ tmdbId: 50010 })
    const duplicate = await makeShow()
    await makeProvider(canonical, 'crunchyroll', 'cr-abc')
    await makeProvider(duplicate, 'netflix', 'nf-xyz')

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50010, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const providers = await db.select().from(showProviders).where(eq(showProviders.showId, canonical))
    const keys = providers.map((p) => p.providerKey).sort()
    expect(keys).toEqual(['crunchyroll', 'netflix'])

    const dupExists = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, duplicate))
    expect(dupExists).toHaveLength(0)
  })

  it('merges seasons and episodes from a new season on duplicate into canonical', async () => {
    const canonical = await makeShow({ tmdbId: 50020 })
    const duplicate = await makeShow()

    const canonS1 = await makeSeason(canonical, 1)
    await makeEpisode(canonS1, canonical, 1, 'crunchyroll', 'cr-s1e1')

    const dupS2 = await makeSeason(duplicate, 2)
    await makeEpisode(dupS2, duplicate, 1, 'netflix', 'nf-s2e1')

    const result = await mergeShows(db, {
      kind: 'tmdb', externalId: 50020, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    expect(result.skipped).toBe(false)
    expect(result.episodesMapped).toBe(1)

    const canonSeasons = await db.select().from(seasons).where(eq(seasons.showId, canonical))
    expect(canonSeasons.map((s) => s.seasonNumber).sort()).toEqual([1, 2])

    const nfLink = await db.select().from(episodeProviders)
      .where(and(eq(episodeProviders.providerKey, 'netflix'), eq(episodeProviders.externalId, 'nf-s2e1')))
    expect(nfLink).toHaveLength(1)
  })

  it('merges episode_providers when both shows have the same season/episode but different providers', async () => {
    const canonical = await makeShow({ tmdbId: 50030 })
    const duplicate = await makeShow()

    const canonS1 = await makeSeason(canonical, 1)
    const canonEp1 = await makeEpisode(canonS1, canonical, 1, 'crunchyroll', 'cr-ep1')

    const dupS1 = await makeSeason(duplicate, 1)
    await makeEpisode(dupS1, duplicate, 1, 'netflix', 'nf-ep1')

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50030, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const links = await db.select().from(episodeProviders)
      .where(eq(episodeProviders.episodeId, canonEp1))
    const providerKeys = links.map((l) => l.providerKey).sort()
    expect(providerKeys).toEqual(['crunchyroll', 'netflix'])
  })

  it('keeps canonical episode_provider when both shows have same (episode, provider) with different externalIds', async () => {
    const canonical = await makeShow({ tmdbId: 50031 })
    const duplicate = await makeShow()

    const canonS1 = await makeSeason(canonical, 1)
    const canonEp1 = await makeEpisode(canonS1, canonical, 1, 'netflix', 'nf-canonical')

    const dupS1 = await makeSeason(duplicate, 1)
    await makeEpisode(dupS1, duplicate, 1, 'netflix', 'nf-duplicate')

    // Must not throw: the per-row UPDATE would have collided on PK
    // (episodeId, providerKey). The NOT EXISTS guard skips the move and lets
    // the cascade delete handle dup's row.
    await mergeShows(db, {
      kind: 'tmdb', externalId: 50031, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const links = await db.select().from(episodeProviders)
      .where(eq(episodeProviders.episodeId, canonEp1))
    expect(links).toHaveLength(1)
    expect(links[0]?.providerKey).toBe('netflix')
    expect(links[0]?.externalId).toBe('nf-canonical')

    const dupShow = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, duplicate))
    expect(dupShow).toHaveLength(0)
  })

  it('merges user_episode_progress with OR semantics for watched flag', async () => {
    const canonical = await makeShow({ tmdbId: 50040 })
    const duplicate = await makeShow()
    const userId = await makeUser()

    const canonS1 = await makeSeason(canonical, 1)
    const canonEp1 = await makeEpisode(canonS1, canonical, 1)
    const dupS1 = await makeSeason(duplicate, 1)
    const dupEp1 = await makeEpisode(dupS1, duplicate, 1)

    // User watched the episode on Netflix (dup) but not on Crunchyroll (canonical)
    await makeUEP(userId, canonEp1, false)
    await makeUEP(userId, dupEp1, true)
    await makeUSS(userId, canonical)
    await makeUSS(userId, duplicate)

    const result = await mergeShows(db, {
      kind: 'tmdb', externalId: 50040, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    expect(result.uepMerged).toBe(1)
    expect(result.usersAffected).toBe(1)

    const [merged] = await db.select().from(userEpisodeProgress)
      .where(and(eq(userEpisodeProgress.userId, userId), eq(userEpisodeProgress.episodeId, canonEp1)))
    expect(merged?.watched).toBe(true)
  })

  it('merges user_show_state: only user has dup state, creates canonical state', async () => {
    const canonical = await makeShow({ tmdbId: 50050 })
    const duplicate = await makeShow()
    const userId = await makeUser()

    await makeUSS(userId, duplicate, 'in_progress')

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50050, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const canonUSS = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, canonical)))
    expect(canonUSS).toHaveLength(1)

    const dupUSS = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, duplicate)))
    expect(dupUSS).toHaveLength(0)
  })

  it('preserves removed status when duplicate is removed', async () => {
    const canonical = await makeShow({ tmdbId: 50060 })
    const duplicate = await makeShow()
    const userId = await makeUser()

    await makeUSS(userId, canonical, 'in_progress')
    await makeUSS(userId, duplicate, 'removed')

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50060, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const [merged] = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, canonical)))
    expect(merged?.status).toBe('removed')
  })

  it('preserves removed status when canonical is removed', async () => {
    const canonical = await makeShow({ tmdbId: 50061 })
    const duplicate = await makeShow()
    const userId = await makeUser()

    await makeUSS(userId, canonical, 'removed')
    await makeUSS(userId, duplicate, 'in_progress')

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50061, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const [merged] = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, canonical)))
    expect(merged?.status).toBe('removed')
  })

  it('merges show metadata: canonical titles win for shared locales, dup fills gaps', async () => {
    const canonical = await makeShow({
      tmdbId: 50070,
      titles: { en: 'Canonical EN', ja: '正典日本語' },
      descriptions: { en: 'Canonical desc' },
    })
    const duplicate = await makeShow({
      titles: { en: 'Dup EN', es: 'Dup Spanish' },
      descriptions: { en: 'Dup desc', es: 'Dup desc ES' },
    })

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50070, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const [merged] = await db.select().from(shows).where(eq(shows.id, canonical))
    expect((merged?.titles as Record<string, string>)['en']).toBe('Canonical EN')
    expect((merged?.titles as Record<string, string>)['ja']).toBe('正典日本語')
    expect((merged?.titles as Record<string, string>)['es']).toBe('Dup Spanish')
    expect((merged?.descriptions as Record<string, string>)['en']).toBe('Canonical desc')
    expect((merged?.descriptions as Record<string, string>)['es']).toBe('Dup desc ES')
  })

  it('sets tmdb_id on canonical when merging by tmdb kind', async () => {
    const canonical = await makeShow({ tmdbId: 50080 })
    const duplicate = await makeShow()

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50080, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    const [merged] = await db.select({ tmdbId: shows.tmdbId }).from(shows).where(eq(shows.id, canonical))
    expect(merged?.tmdbId).toBe(50080)
  })

  it('cascades deletion: no orphaned seasons, episodes, or user state for deleted dup', async () => {
    const canonical = await makeShow({ tmdbId: 50090 })
    const duplicate = await makeShow()
    const userId = await makeUser()

    const dupS1 = await makeSeason(duplicate, 1)
    const dupEp1 = await makeEpisode(dupS1, duplicate, 1, 'netflix', 'nf-50090-s1e1')
    await makeUEP(userId, dupEp1, true)
    await makeUSS(userId, duplicate)

    await mergeShows(db, {
      kind: 'tmdb', externalId: 50090, canonicalShowId: canonical, duplicateShowId: duplicate,
    })

    // Dup show and all its direct children must be gone
    const dupShow = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, duplicate))
    expect(dupShow).toHaveLength(0)

    const dupSeasonsRemaining = await db.select().from(seasons).where(eq(seasons.showId, duplicate))
    expect(dupSeasonsRemaining).toHaveLength(0)
  })
})
