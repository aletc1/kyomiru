import '../loadEnv.js'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createDbClient, type DbClient } from '@kyomiru/db/client'
import {
  shows, seasons, episodes, episodeProviders,
  users, userEpisodeProgress,
} from '@kyomiru/db/schema'
import {
  findPhantoms,
  deletePhantoms,
  cleanupPhantomsForShow,
} from '../services/phantomEpisodes.service.js'

const DATABASE_URL = process.env['DATABASE_URL']

describe.skipIf(!DATABASE_URL)('phantomEpisodes.service (DB)', () => {
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

  /**
   * Build a show with two seasons:
   *   S1: legacy Crunchyroll-bunched shape — episodes carry provider-less rows
   *       (the phantom candidates) plus one provider-backed real episode so the
   *       season satisfies the "catalog-fetched" predicate.
   *   S2: TMDb's correct shape — every episode has a provider mapping and is
   *       the canonical row.
   */
  async function makePhantomShow(opts: {
    s1ProviderlessTitles: string[]
    s1ProviderBackedTitle: string
    s2Titles: string[]
  }) {
    const tag = Math.random().toString(36).slice(2, 8)
    const title = `Phantom Show ${tag}`
    const [show] = await db.insert(shows).values({
      canonicalTitle: title,
      titleNormalized: title.toLowerCase(),
      titles: { en: title },
      descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(show!.id)

    const s1Total = opts.s1ProviderlessTitles.length + 1
    const s2Total = opts.s2Titles.length
    const [s1] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 1, episodeCount: s1Total, titles: {},
    }).returning({ id: seasons.id })
    const [s2] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 2, episodeCount: s2Total, titles: {},
    }).returning({ id: seasons.id })

    const s1Phantoms: string[] = []
    let epNum = 1
    for (const t of opts.s1ProviderlessTitles) {
      const [ep] = await db.insert(episodes).values({
        seasonId: s1!.id, showId: show!.id, episodeNumber: epNum++, title: t, titles: {}, descriptions: {},
      }).returning({ id: episodes.id })
      s1Phantoms.push(ep!.id)
    }
    const [s1Real] = await db.insert(episodes).values({
      seasonId: s1!.id, showId: show!.id, episodeNumber: epNum++, title: opts.s1ProviderBackedTitle, titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    await db.insert(episodeProviders).values({
      episodeId: s1Real!.id, providerKey: 'crunchyroll', externalId: `cr-s1real-${randomUUID()}`,
    })

    const s2Eps: string[] = []
    epNum = 1
    for (const t of opts.s2Titles) {
      const [ep] = await db.insert(episodes).values({
        seasonId: s2!.id, showId: show!.id, episodeNumber: epNum++, title: t, titles: {}, descriptions: {},
      }).returning({ id: episodes.id })
      s2Eps.push(ep!.id)
      await db.insert(episodeProviders).values({
        episodeId: ep!.id, providerKey: 'crunchyroll', externalId: `cr-s2-${randomUUID()}`,
      })
    }

    return { showId: show!.id, s1Id: s1!.id, s2Id: s2!.id, s1Phantoms, s1Real: s1Real!.id, s2Eps }
  }

  async function makeUser() {
    const tag = Math.random().toString(36).slice(2, 8)
    const [user] = await db.insert(users).values({
      googleSub: `sub-phantom-${tag}`, email: `phantom-${tag}@example.com`, displayName: `Phantom ${tag}`,
    }).returning({ id: users.id })
    createdUserIds.push(user!.id)
    return user!.id
  }

  it('cleanupPhantomsForShow deletes a cross-season title-collision phantom and recomputes season counts', async () => {
    const { showId, s1Id, s2Id, s1Phantoms } = await makePhantomShow({
      s1ProviderlessTitles: ['The Beginning', 'The Reveal'],
      s1ProviderBackedTitle: 'Real S1 Finale',
      s2Titles: ['The Beginning', 'The Reveal', 'Real S2 Finale'],
    })

    const result = await cleanupPhantomsForShow(db, showId)

    expect(result.deleted).toBe(2)
    expect(result.seasonsTouched).toBe(1)

    const survivors = await db.select({ id: episodes.id })
      .from(episodes).where(inArray(episodes.id, s1Phantoms))
    expect(survivors).toHaveLength(0)

    const [s1Row] = await db.select({ episodeCount: seasons.episodeCount })
      .from(seasons).where(eq(seasons.id, s1Id))
    expect(s1Row?.episodeCount).toBe(1) // only the provider-backed s1Real remains

    const [s2Row] = await db.select({ episodeCount: seasons.episodeCount })
      .from(seasons).where(eq(seasons.id, s2Id))
    expect(s2Row?.episodeCount).toBe(3) // S2 untouched
  })

  it('preserves a candidate that gained user_episode_progress between find and delete (TOCTOU defense)', async () => {
    const { showId, s1Phantoms } = await makePhantomShow({
      s1ProviderlessTitles: ['Vanish Me', 'Save Me'],
      s1ProviderBackedTitle: 'Real S1 Finale',
      s2Titles: ['Vanish Me', 'Save Me', 'Real S2 Finale'],
    })

    // Simulate the race: findPhantoms runs first (sees both as phantoms),
    // THEN a sync ingest writes progress for one of them, THEN we delete.
    const phantoms = await findPhantoms(db, showId)
    expect(phantoms).toHaveLength(2)

    const userId = await makeUser()
    const protectedEp = s1Phantoms[1]! // "Save Me"
    await db.insert(userEpisodeProgress).values({
      userId, episodeId: protectedEp, watched: true,
      watchedAt: new Date(), lastEventAt: new Date(),
    })

    const result = await deletePhantoms(db, phantoms)

    expect(result.deleted).toBe(1) // only "Vanish Me"
    expect(result.seasonsTouched).toBe(1)

    const stillThere = await db.select({ id: episodes.id })
      .from(episodes).where(eq(episodes.id, protectedEp))
    expect(stillThere).toHaveLength(1) // progress-protected survivor
  })

  it('does not delete an episode whose own season has no other provider-backed peer', async () => {
    // S1 has only one episode (no provider-backed peer in S1). Even though its
    // title collides with an S2 episode, the phantom criteria require S1 to
    // have at least one OTHER provider-backed episode — so this is preserved.
    const tag = Math.random().toString(36).slice(2, 8)
    const title = `Lonely Show ${tag}`
    const [show] = await db.insert(shows).values({
      canonicalTitle: title, titleNormalized: title.toLowerCase(),
      titles: { en: title }, descriptions: {},
    }).returning({ id: shows.id })
    createdShowIds.push(show!.id)

    const [s1] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 1, episodeCount: 0, titles: {},
    }).returning({ id: seasons.id })
    const [s2] = await db.insert(seasons).values({
      showId: show!.id, seasonNumber: 2, episodeCount: 0, titles: {},
    }).returning({ id: seasons.id })

    const [lonelyEp] = await db.insert(episodes).values({
      seasonId: s1!.id, showId: show!.id, episodeNumber: 1,
      title: 'Shared Title', titles: {}, descriptions: {},
    }).returning({ id: episodes.id })

    const [s2Ep] = await db.insert(episodes).values({
      seasonId: s2!.id, showId: show!.id, episodeNumber: 1,
      title: 'Shared Title', titles: {}, descriptions: {},
    }).returning({ id: episodes.id })
    await db.insert(episodeProviders).values({
      episodeId: s2Ep!.id, providerKey: 'crunchyroll', externalId: `cr-lonely-${randomUUID()}`,
    })

    const result = await cleanupPhantomsForShow(db, show!.id)

    expect(result.deleted).toBe(0)
    const stillThere = await db.select({ id: episodes.id })
      .from(episodes).where(eq(episodes.id, lonelyEp!.id))
    expect(stillThere).toHaveLength(1)
  })
})
