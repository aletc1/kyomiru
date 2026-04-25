import '../loadEnv.js'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Redis } from 'ioredis'
import { inArray, eq, and } from 'drizzle-orm'
import { createDbClient, type DbClient } from '@kyomiru/db/client'
import {
  shows, showProviders, seasons, episodes, episodeProviders,
  users, userShowState, userEpisodeProgress,
} from '@kyomiru/db/schema'
import { randomUUID } from 'node:crypto'
import {
  isWatched,
  mergeSeasonInBatch,
  mergeEpisodeInBatch,
  ingestChunk,
  reResolveOrphanedEpisodes,
  resolveShowCatalogStatus,
  type SeasonInsertValue,
} from '../services/sync.service.js'
import { mergeShows } from '../services/showMerge.js'

const DATABASE_URL = process.env['DATABASE_URL']
const REDIS_URL = process.env['REDIS_URL']

// Integration tests for ingestChunk require a running Postgres + Redis.
// Run with `pnpm db:up` first; skipped automatically if env vars are absent.

describe('isWatched', () => {
  it('returns true when fullyWatched is true regardless of playhead', () => {
    expect(isWatched(0, 0, true)).toBe(true)
    expect(isWatched(undefined, undefined, true)).toBe(true)
  })

  it('returns true at exactly the 90 % threshold', () => {
    expect(isWatched(900, 1000, false)).toBe(true)
    expect(isWatched(899, 1000, false)).toBe(false)
  })

  it('returns false when duration is zero (avoids divide-by-zero)', () => {
    expect(isWatched(0, 0, false)).toBe(false)
  })

  it('returns false when playhead or duration is undefined', () => {
    expect(isWatched(undefined, 1000, false)).toBe(false)
    expect(isWatched(900, undefined, false)).toBe(false)
  })
})

// Regression coverage for the in-batch dedup: prior versions of upsertShowCatalog
// crashed with "ON CONFLICT DO UPDATE command cannot affect row a second time"
// when fractional ordinals (e.g. season 2.5 / episode 11.5) floored to an
// integer that was already in the same batch.
describe('mergeSeasonInBatch', () => {
  const base: SeasonInsertValue = {
    showId: 'show-1',
    seasonNumber: 2,
    title: null,
    airDate: null,
    episodeCount: 0,
    titles: {},
  }

  it('keeps prev.title (first-non-null wins) and merges titles JSONB with next winning shared keys', () => {
    const prev = { ...base, title: 'Season 2', titles: { en: 'Season 2', ja: '第2期' } }
    const next = { ...base, title: 'OVA Specials', titles: { en: 'OVAs', es: 'Temporada 2' } }
    const merged = mergeSeasonInBatch(prev, next)
    expect(merged.title).toBe('Season 2')
    expect(merged.titles).toEqual({ en: 'OVAs', ja: '第2期', es: 'Temporada 2' })
  })

  it('falls through to next.title when prev.title is null', () => {
    const prev = { ...base, title: null }
    const next = { ...base, title: 'OVA Specials' }
    expect(mergeSeasonInBatch(prev, next).title).toBe('OVA Specials')
  })

  it('takes the max episodeCount (mirrors GREATEST in SQL ON CONFLICT)', () => {
    const prev = { ...base, episodeCount: 12 }
    const next = { ...base, episodeCount: 4 }
    expect(mergeSeasonInBatch(prev, next).episodeCount).toBe(12)
    expect(mergeSeasonInBatch(next, prev).episodeCount).toBe(12)
  })

  it('keeps prev.airDate if set', () => {
    const prev = { ...base, airDate: '2024-01-01' }
    const next = { ...base, airDate: '2024-06-01' }
    expect(mergeSeasonInBatch(prev, next).airDate).toBe('2024-01-01')
  })
})

describe('mergeEpisodeInBatch', () => {
  const base = {
    seasonId: 'season-1',
    showId: 'show-1',
    episodeNumber: 11,
    title: null,
    titles: {} as Record<string, string>,
    descriptions: {} as Record<string, string>,
    durationSeconds: null,
    airDate: null,
  }

  it('mirrors COALESCE for scalar fields (prev wins when set)', () => {
    const prev = { ...base, title: 'Episode 11', durationSeconds: 1440, airDate: '2024-03-15' }
    const next = { ...base, title: 'Recap 11.5', durationSeconds: 600, airDate: '2024-03-22' }
    const merged = mergeEpisodeInBatch(prev, next)
    expect(merged.title).toBe('Episode 11')
    expect(merged.durationSeconds).toBe(1440)
    expect(merged.airDate).toBe('2024-03-15')
  })

  it('falls through to next when prev fields are null', () => {
    const prev = { ...base, title: null, durationSeconds: null, airDate: null }
    const next = { ...base, title: 'Recap', durationSeconds: 600, airDate: '2024-03-22' }
    const merged = mergeEpisodeInBatch(prev, next)
    expect(merged.title).toBe('Recap')
    expect(merged.durationSeconds).toBe(600)
    expect(merged.airDate).toBe('2024-03-22')
  })

  it('merges titles and descriptions JSONB with next winning shared keys', () => {
    const prev = {
      ...base,
      titles: { en: 'Episode 11', ja: '第11話' },
      descriptions: { en: 'Original synopsis' },
    }
    const next = {
      ...base,
      titles: { en: 'Recap 11.5', es: 'Episodio 11' },
      descriptions: { en: 'Updated synopsis', ja: '日本語' },
    }
    const merged = mergeEpisodeInBatch(prev, next)
    expect(merged.titles).toEqual({ en: 'Recap 11.5', ja: '第11話', es: 'Episodio 11' })
    expect(merged.descriptions).toEqual({ en: 'Updated synopsis', ja: '日本語' })
  })
})

describe.skipIf(!DATABASE_URL || !REDIS_URL)('ingestChunk (DB + Redis)', () => {
  let db: DbClient
  let redis: Redis
  const createdShowIds: string[] = []
  const createdUserIds: string[] = []

  beforeAll(async () => {
    db = createDbClient(DATABASE_URL!)
    redis = new Redis(REDIS_URL!)
    await redis.ping()
  })

  afterAll(async () => {
    await redis.quit()
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

  async function makeUser() {
    const s = Math.random().toString(36).slice(2, 8)
    const [row] = await db.insert(users).values({
      googleSub: `sub-${s}`,
      email: `user-${s}@example.com`,
      displayName: `User ${s}`,
    }).returning({ id: users.id })
    createdUserIds.push(row!.id)
    return row!.id
  }

  async function makeShow(tmdbId?: number) {
    const s = Math.random().toString(36).slice(2, 8)
    const title = `Test Show ${s}`
    const [row] = await db.insert(shows).values({
      canonicalTitle: title,
      titleNormalized: title.toLowerCase(),
      tmdbId: tmdbId ?? null,
      titles: { en: title },
      descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(row!.id)
    return row!.id
  }

  async function makeSeasonAndEpisode(showId: string, providerEpKey?: string) {
    const [season] = await db.insert(seasons).values({
      showId, seasonNumber: 1, episodeCount: 1, titles: {},
    }).returning({ id: seasons.id })
    const [episode] = await db.insert(episodes).values({
      seasonId: season!.id, showId, episodeNumber: 1, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    if (providerEpKey) {
      await db.insert(episodeProviders).values({
        episodeId: episode!.id, providerKey: 'crunchyroll', externalId: providerEpKey,
      }).onConflictDoNothing()
    }
    return episode!.id
  }

  it('creates user_show_state when a history item resolves to a known episode', async () => {
    const userId = await makeUser()
    const showId = await makeShow()
    await db.insert(showProviders).values({ showId, providerKey: 'crunchyroll', externalId: 'cr-show-basic' }).onConflictDoNothing()
    await makeSeasonAndEpisode(showId, 'cr-ep-basic-01')

    await ingestChunk(
      db, userId, 'crunchyroll',
      [{ externalItemId: 'cr-ep-basic-01', externalShowId: 'cr-show-basic', watchedAt: new Date('2024-06-01'), fullyWatched: true, raw: {} }],
      [],
      randomUUID(),
      null,
      redis,
    )

    const rows = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('in_progress')
  })

  it('resolves items via metadata fallback and rewrites stale episode_providers (regression: Crunchyroll panel-id mismatch)', async () => {
    // Crunchyroll exposes different IDs in watch history (panel.id) vs the catalog
    // endpoint (episode.id). When the catalog path stores episode IDs that never
    // match incoming panel IDs, items would silently be skipped. The fallback in
    // ingestChunk must resolve them by (season_number, episode_number) from raw
    // metadata and replace the stale external_id so future syncs resolve directly.
    const userId = await makeUser()
    const showId = await makeShow()
    await db.insert(showProviders).values({
      showId, providerKey: 'crunchyroll', externalId: 'cr-show-frieren',
    }).onConflictDoNothing()

    const [season] = await db.insert(seasons).values({
      showId, seasonNumber: 2, episodeCount: 2, titles: {},
    }).returning({ id: seasons.id })
    const [ep1] = await db.insert(episodes).values({
      seasonId: season!.id, showId, episodeNumber: 1, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    const [ep2] = await db.insert(episodes).values({
      seasonId: season!.id, showId, episodeNumber: 2, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })

    // Seed episode_providers with the WRONG (catalog-style) external IDs that
    // will never appear in watch history.
    await db.insert(episodeProviders).values([
      { episodeId: ep1!.id, providerKey: 'crunchyroll', externalId: 'cr-catalog-ep1' },
      { episodeId: ep2!.id, providerKey: 'crunchyroll', externalId: 'cr-catalog-ep2' },
    ]).onConflictDoNothing()

    // Send items with PANEL IDs (do not match episode_providers) plus season/
    // episode numbers in raw, which is what the Crunchyroll adapter emits.
    await ingestChunk(
      db, userId, 'crunchyroll',
      [
        {
          externalItemId: 'cr-panel-ep1',
          externalShowId: 'cr-show-frieren',
          watchedAt: new Date('2024-06-01'),
          fullyWatched: true,
          raw: { season_number: 2, episode_number: 1 },
        },
        {
          externalItemId: 'cr-panel-ep2',
          externalShowId: 'cr-show-frieren',
          watchedAt: new Date('2024-06-02'),
          fullyWatched: true,
          raw: { season_number: 2, episode_number: 2 },
        },
      ],
      [],
      randomUUID(),
      null,
      redis,
    )

    // Both items must have been resolved (not skipped) and a user_episode_progress
    // row created for each — the user_show_state aggregate is filled in later by
    // finalizeIngestRun → recomputeUserShowState, so we check progress directly.
    const progress = await db.select().from(userEpisodeProgress)
      .where(and(eq(userEpisodeProgress.userId, userId), inArray(userEpisodeProgress.episodeId, [ep1!.id, ep2!.id])))
    expect(progress).toHaveLength(2)
    expect(progress.every((r) => r.watched)).toBe(true)

    // Stale catalog IDs should have been replaced with the panel IDs so future
    // fast-path syncs (items-only chunks) resolve directly via episode_providers.
    const eps = await db.select({ episodeId: episodeProviders.episodeId, externalId: episodeProviders.externalId })
      .from(episodeProviders)
      .where(and(
        eq(episodeProviders.providerKey, 'crunchyroll'),
        inArray(episodeProviders.episodeId, [ep1!.id, ep2!.id]),
      ))
    const byEp = new Map(eps.map((r) => [r.episodeId, r.externalId]))
    expect(byEp.get(ep1!.id)).toBe('cr-panel-ep1')
    expect(byEp.get(ep2!.id)).toBe('cr-panel-ep2')
  })

  it('does not skip an item whose external ID already matches even when other items in the chunk go through the metadata fallback', async () => {
    // Mixed chunk: ep1 has the correct mapping in episode_providers, ep2 needs
    // the metadata fallback. Both must be ingested.
    const userId = await makeUser()
    const showId = await makeShow()
    await db.insert(showProviders).values({
      showId, providerKey: 'crunchyroll', externalId: 'cr-show-mixed',
    }).onConflictDoNothing()

    const [season] = await db.insert(seasons).values({
      showId, seasonNumber: 1, episodeCount: 2, titles: {},
    }).returning({ id: seasons.id })
    const [ep1] = await db.insert(episodes).values({
      seasonId: season!.id, showId, episodeNumber: 1, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    const [ep2] = await db.insert(episodes).values({
      seasonId: season!.id, showId, episodeNumber: 2, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    await db.insert(episodeProviders).values([
      { episodeId: ep1!.id, providerKey: 'crunchyroll', externalId: 'cr-panel-mixed-ep1' },
      { episodeId: ep2!.id, providerKey: 'crunchyroll', externalId: 'cr-catalog-mixed-ep2' },
    ]).onConflictDoNothing()

    await ingestChunk(
      db, userId, 'crunchyroll',
      [
        {
          externalItemId: 'cr-panel-mixed-ep1',
          externalShowId: 'cr-show-mixed',
          watchedAt: new Date('2024-06-01'),
          fullyWatched: true,
          raw: { season_number: 1, episode_number: 1 },
        },
        {
          externalItemId: 'cr-panel-mixed-ep2',
          externalShowId: 'cr-show-mixed',
          watchedAt: new Date('2024-06-02'),
          fullyWatched: true,
          raw: { season_number: 1, episode_number: 2 },
        },
      ],
      [],
      randomUUID(),
      null,
      redis,
    )

    const progress = await db.select().from(userEpisodeProgress)
      .where(and(eq(userEpisodeProgress.userId, userId), inArray(userEpisodeProgress.episodeId, [ep1!.id, ep2!.id])))
    expect(progress).toHaveLength(2)
    expect(progress.every((r) => r.watched)).toBe(true)

    // ep1's mapping was already correct and should not have been disturbed.
    const ep1Row = await db.select().from(episodeProviders)
      .where(and(eq(episodeProviders.episodeId, ep1!.id), eq(episodeProviders.providerKey, 'crunchyroll')))
    expect(ep1Row[0]?.externalId).toBe('cr-panel-mixed-ep1')
    // ep2's stale catalog ID should now be the working panel ID.
    const ep2Row = await db.select().from(episodeProviders)
      .where(and(eq(episodeProviders.episodeId, ep2!.id), eq(episodeProviders.providerKey, 'crunchyroll')))
    expect(ep2Row[0]?.externalId).toBe('cr-panel-mixed-ep2')
  })

  it('skips items via the metadata fallback when raw lacks season/episode numbers', async () => {
    // Items that arrive without season/episode metadata cannot be resolved by the
    // fallback and must remain skipped (counted as itemsSkipped, no FK violations).
    const userId = await makeUser()
    const showId = await makeShow()
    await db.insert(showProviders).values({
      showId, providerKey: 'crunchyroll', externalId: 'cr-show-noraw',
    }).onConflictDoNothing()
    await makeSeasonAndEpisode(showId, 'cr-catalog-noraw-ep1')

    await ingestChunk(
      db, userId, 'crunchyroll',
      [{
        externalItemId: 'cr-panel-noraw-ep1',
        externalShowId: 'cr-show-noraw',
        watchedAt: new Date('2024-06-01'),
        fullyWatched: true,
        raw: {},
      }],
      [],
      randomUUID(),
      null,
      redis,
    )

    // No progress row should exist — the item couldn't be resolved.
    const progress = await db.select().from(userEpisodeProgress)
      .where(eq(userEpisodeProgress.userId, userId))
    expect(progress).toHaveLength(0)
  })

  it('creates user_show_state for the canonical show after mergeShows migrates episode_providers', async () => {
    // Regression for the merge-race bug: a show available on both Crunchyroll and
    // Netflix (e.g. Frieren) ends up as two separate rows. Enrichment detects the
    // same tmdb_id and runs mergeShows. After the merge, the user re-syncs from
    // Crunchyroll. The Crunchyroll episode_providers rows now point to the
    // canonical episodes; ingestChunk must create user_show_state for the canonical
    // show, not the (now-deleted) duplicate.
    const userId = await makeUser()

    const canonical = await makeShow(70001)
    await db.insert(showProviders).values({ showId: canonical, providerKey: 'crunchyroll', externalId: 'cr-frieren' }).onConflictDoNothing()
    await makeSeasonAndEpisode(canonical)

    const duplicate = await makeShow()
    await db.insert(showProviders).values({ showId: duplicate, providerKey: 'netflix', externalId: 'nf-frieren' }).onConflictDoNothing()
    await makeSeasonAndEpisode(duplicate, 'cr-ep-frieren-01')

    const result = await mergeShows(db, {
      kind: 'tmdb', externalId: 70001, canonicalShowId: canonical, duplicateShowId: duplicate,
    })
    expect(result.skipped).toBe(false)

    const dupGone = await db.select({ id: shows.id }).from(shows).where(eq(shows.id, duplicate))
    expect(dupGone).toHaveLength(0)

    await ingestChunk(
      db, userId, 'crunchyroll',
      [{ externalItemId: 'cr-ep-frieren-01', externalShowId: 'cr-frieren', watchedAt: new Date('2024-10-01'), fullyWatched: true, raw: {} }],
      [],
      randomUUID(),
      null,
      redis,
    )

    const uss = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, canonical)))
    expect(uss).toHaveLength(1)
    expect(uss[0]?.status).toBe('in_progress')
  })
})

describe.skipIf(!DATABASE_URL)('reResolveOrphanedEpisodes (DB)', () => {
  let db: DbClient
  const createdShowIds: string[] = []

  beforeAll(() => {
    db = createDbClient(DATABASE_URL!)
  })

  afterEach(async () => {
    if (createdShowIds.length > 0) {
      await db.delete(shows).where(inArray(shows.id, createdShowIds))
      createdShowIds.length = 0
    }
  })

  async function makeCanonicalEp(externalId: string) {
    const s = Math.random().toString(36).slice(2, 8)
    const title = `Show ${s}`
    const [show] = await db.insert(shows).values({
      canonicalTitle: title, titleNormalized: title.toLowerCase(),
      titles: { en: title }, descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(show!.id)
    const [season] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 1, episodeCount: 1, titles: {},
    }).returning({ id: seasons.id })
    const [ep] = await db.insert(episodes).values({
      seasonId: season!.id, showId: show!.id, episodeNumber: 1, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    await db.insert(episodeProviders).values({
      episodeId: ep!.id, providerKey: 'crunchyroll', externalId,
    }).onConflictDoNothing()
    return { showId: show!.id, episodeId: ep!.id }
  }

  it('remaps stale episode IDs to canonical IDs from episode_providers', async () => {
    // Simulates the exact post-race state: episode_providers points at the
    // canonical episode (the merge worker installed it), but the caller's
    // resolution map still holds the stale duplicate ID and stillExistingEpSet
    // is empty (the validation query found nothing).
    const { showId, episodeId } = await makeCanonicalEp('cr-orphan-01')
    const stalePhantomId = randomUUID() // never existed in episodes

    const episodeIdByExtItemId = new Map<string, string>([['cr-orphan-01', stalePhantomId]])
    const showIdByEpisodeId = new Map<string, string>()
    const stillExistingEpSet = new Set<string>()

    await reResolveOrphanedEpisodes(
      db, 'crunchyroll',
      [{ externalItemId: 'cr-orphan-01' }],
      episodeIdByExtItemId, showIdByEpisodeId, stillExistingEpSet,
    )

    expect(episodeIdByExtItemId.get('cr-orphan-01')).toBe(episodeId)
    expect(stillExistingEpSet.has(episodeId)).toBe(true)
    expect(showIdByEpisodeId.get(episodeId)).toBe(showId)
  })

  it('leaves the maps unchanged when no IDs are orphaned', async () => {
    const { episodeId } = await makeCanonicalEp('cr-fresh-01')
    const episodeIdByExtItemId = new Map<string, string>([['cr-fresh-01', episodeId]])
    const showIdByEpisodeId = new Map<string, string>()
    const stillExistingEpSet = new Set<string>([episodeId])

    await reResolveOrphanedEpisodes(
      db, 'crunchyroll',
      [{ externalItemId: 'cr-fresh-01' }],
      episodeIdByExtItemId, showIdByEpisodeId, stillExistingEpSet,
    )

    expect(episodeIdByExtItemId.get('cr-fresh-01')).toBe(episodeId)
    expect(showIdByEpisodeId.size).toBe(0) // not re-validated
  })

  it('drops items whose external IDs are no longer in episode_providers', async () => {
    // If the merge somehow removed the episode_providers row entirely (e.g. the
    // canonical episode already had a row for this provider, so the dup row was
    // cascade-deleted without migration), the orphan stays orphaned and the
    // outer filter in ingestChunk will skip it.
    const stalePhantomId = randomUUID()
    const episodeIdByExtItemId = new Map<string, string>([['cr-vanished-01', stalePhantomId]])
    const showIdByEpisodeId = new Map<string, string>()
    const stillExistingEpSet = new Set<string>()

    await reResolveOrphanedEpisodes(
      db, 'crunchyroll',
      [{ externalItemId: 'cr-vanished-01' }],
      episodeIdByExtItemId, showIdByEpisodeId, stillExistingEpSet,
    )

    // No mapping change — caller will see stalePhantomId not in stillExistingEpSet
    // and filter the item out.
    expect(episodeIdByExtItemId.get('cr-vanished-01')).toBe(stalePhantomId)
    expect(stillExistingEpSet.size).toBe(0)
  })
})

describe.skipIf(!DATABASE_URL)('resolveShowCatalogStatus (DB)', () => {
  let db: DbClient
  const createdShowIds: string[] = []

  beforeAll(() => {
    db = createDbClient(DATABASE_URL!)
  })

  afterEach(async () => {
    if (createdShowIds.length > 0) {
      await db.delete(shows).where(inArray(shows.id, createdShowIds))
      createdShowIds.length = 0
    }
  })

  it('returns sparse episode set when only the last episode has a provider mapping (regression: ep-13-only bug)', async () => {
    // Simulates the database state produced when a catalog fetch fails and the
    // history-only fallback writes only the watched episode, then enrichment
    // later fills `episodes` (providerKey=null, no episode_providers rows).
    // resolveShowCatalogStatus must return the actual mapped set [13], not MAX=13,
    // so isSeriesFresh forces a slow-path catalog refetch.
    const s = Math.random().toString(36).slice(2, 8)
    const title = `Isekai Test Show ${s}`
    const [show] = await db.insert(shows).values({
      canonicalTitle: title,
      titleNormalized: title.toLowerCase(),
      titles: { en: title },
      descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(show!.id)

    const extShowId = `cr-isekai-${s}`
    await db.insert(showProviders).values({
      showId: show!.id,
      providerKey: 'crunchyroll',
      externalId: extShowId,
    }).onConflictDoNothing()

    const [season] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 1, episodeCount: 13, titles: {},
    }).returning({ id: seasons.id })

    // Insert all 13 episodes (as enrichment from TMDb would) — but only wire
    // episode 13 to Crunchyroll via episode_providers.
    const epIds: string[] = []
    for (let n = 1; n <= 13; n++) {
      const [ep] = await db.insert(episodes).values({
        seasonId: season!.id, showId: show!.id, episodeNumber: n, titles: {}, descriptions: {},
      }).returning({ id: episodes.id })
      epIds.push(ep!.id)
    }
    await db.insert(episodeProviders).values({
      episodeId: epIds[12]!, // only ep 13 (index 12)
      providerKey: 'crunchyroll',
      externalId: `cr-panel-ep13-${s}`,
    }).onConflictDoNothing()

    const results = await resolveShowCatalogStatus(db, 'crunchyroll', [extShowId])
    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.known).toBe(true)
    // Must reflect the actual mapped set, not MAX(episode_number).
    expect(result.seasonCoverage).toEqual({ 1: [13] })
  })

  it('returns full dense episode set when all episodes are mapped', async () => {
    const s = Math.random().toString(36).slice(2, 8)
    const title = `Full Show ${s}`
    const [show] = await db.insert(shows).values({
      canonicalTitle: title,
      titleNormalized: title.toLowerCase(),
      titles: { en: title },
      descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(show!.id)

    const extShowId = `cr-full-${s}`
    await db.insert(showProviders).values({
      showId: show!.id,
      providerKey: 'crunchyroll',
      externalId: extShowId,
    }).onConflictDoNothing()

    const [season] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 1, episodeCount: 3, titles: {},
    }).returning({ id: seasons.id })

    for (let n = 1; n <= 3; n++) {
      const [ep] = await db.insert(episodes).values({
        seasonId: season!.id, showId: show!.id, episodeNumber: n, titles: {}, descriptions: {},
      }).returning({ id: episodes.id })
      await db.insert(episodeProviders).values({
        episodeId: ep!.id,
        providerKey: 'crunchyroll',
        externalId: `cr-panel-ep${n}-${s}`,
      }).onConflictDoNothing()
    }

    const results = await resolveShowCatalogStatus(db, 'crunchyroll', [extShowId])
    expect(results[0]?.seasonCoverage).toEqual({ 1: [1, 2, 3] })
  })

  it('returns empty seasonCoverage for a known show with no episode_providers rows', async () => {
    const s = Math.random().toString(36).slice(2, 8)
    const title = `No-EP Show ${s}`
    const [show] = await db.insert(shows).values({
      canonicalTitle: title,
      titleNormalized: title.toLowerCase(),
      titles: { en: title },
      descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(show!.id)

    const extShowId = `cr-noep-${s}`
    await db.insert(showProviders).values({
      showId: show!.id,
      providerKey: 'crunchyroll',
      externalId: extShowId,
    }).onConflictDoNothing()

    const results = await resolveShowCatalogStatus(db, 'crunchyroll', [extShowId])
    expect(results[0]?.known).toBe(true)
    expect(results[0]?.seasonCoverage).toEqual({})
  })
})
