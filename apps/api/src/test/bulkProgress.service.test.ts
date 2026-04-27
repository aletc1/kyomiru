import '../loadEnv.js'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { createDbClient, type DbClient } from '@kyomiru/db/client'
import {
  episodes, seasons, shows, users, userEpisodeProgress, userShowState,
} from '@kyomiru/db/schema'
import { bulkUpdateEpisodeProgress, SeasonNotFoundError } from '../services/bulkProgress.service.js'

const DATABASE_URL = process.env['DATABASE_URL']

describe.skipIf(!DATABASE_URL)('bulkUpdateEpisodeProgress (DB)', () => {
  let db: DbClient
  let userId: string
  let showId: string

  beforeAll(() => {
    db = createDbClient(DATABASE_URL!)
  })

  afterEach(async () => {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    if (showId) await db.delete(shows).where(eq(shows.id, showId))
  })

  const past = (days: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    return d.toISOString().slice(0, 10)
  }

  const future = (days: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  async function setup(seasons_: { episodeAirDates: (string | null)[] }[]) {
    const suffix = Math.random().toString(36).slice(2, 10)

    const [user] = await db.insert(users).values({
      googleSub: `test-${suffix}`,
      email: `test-${suffix}@example.com`,
      displayName: `Test ${suffix}`,
    }).returning({ id: users.id })
    userId = user!.id

    const [show] = await db.insert(shows).values({
      canonicalTitle: `Test Show ${suffix}`,
      titleNormalized: `test show ${suffix}`,
    }).returning({ id: shows.id })
    showId = show!.id

    const seasonIds: string[] = []
    for (let i = 0; i < seasons_.length; i++) {
      const s = seasons_[i]!
      const [season] = await db.insert(seasons).values({
        showId,
        seasonNumber: i + 1,
        episodeCount: s.episodeAirDates.length,
      }).returning({ id: seasons.id })
      seasonIds.push(season!.id)

      if (s.episodeAirDates.length > 0) {
        await db.insert(episodes).values(
          s.episodeAirDates.map((airDate, j) => ({
            seasonId: season!.id,
            showId,
            episodeNumber: j + 1,
            airDate,
          })),
        )
      }
    }

    await db.insert(userShowState).values({
      userId,
      showId,
      status: 'in_progress',
      totalEpisodes: 0,
      watchedEpisodes: 0,
    })

    return { seasonIds }
  }

  async function getProgress(epId: string) {
    const [row] = await db.select().from(userEpisodeProgress)
      .where(and(eq(userEpisodeProgress.userId, userId), eq(userEpisodeProgress.episodeId, epId)))
    return row
  }

  async function getState() {
    const [row] = await db.select().from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))
    return row!
  }

  it('marks all aired episodes of a show as watched and lands status=watched', async () => {
    await setup([{ episodeAirDates: [past(10), past(5), past(1)] }])

    const { episodesUpdated } = await bulkUpdateEpisodeProgress(db, userId, showId, { watched: true })

    expect(episodesUpdated).toBe(3)
    const state = await getState()
    expect(state.watchedEpisodes).toBe(3)
    expect(state.status).toBe('watched')
  })

  it('skips future-dated episodes; lands coming_soon when caught up on aired eps', async () => {
    await setup([{ episodeAirDates: [past(7), past(1), future(7)] }])

    const { episodesUpdated } = await bulkUpdateEpisodeProgress(db, userId, showId, { watched: true })

    expect(episodesUpdated).toBe(2)
    const state = await getState()
    expect(state.watchedEpisodes).toBe(2)
    expect(state.status).toBe('coming_soon')
  })

  it('marks every aired episode across all seasons when seasonId is omitted', async () => {
    await setup([
      { episodeAirDates: [past(20), past(15)] },
      { episodeAirDates: [past(10), past(5), future(5)] },
    ])

    const { episodesUpdated } = await bulkUpdateEpisodeProgress(db, userId, showId, { watched: true })

    expect(episodesUpdated).toBe(4)
    const state = await getState()
    expect(state.totalEpisodes).toBe(4)
    expect(state.watchedEpisodes).toBe(4)
    // hasUpcoming=true (future(5)) → coming_soon, not watched
    expect(state.status).toBe('coming_soon')
  })

  it('scopes to a single season when seasonId is provided', async () => {
    const { seasonIds } = await setup([
      { episodeAirDates: [past(20), past(10)] },
      { episodeAirDates: [past(5), past(2)] },
    ])

    const { episodesUpdated } = await bulkUpdateEpisodeProgress(db, userId, showId, {
      watched: true,
      seasonId: seasonIds[0]!,
    })

    expect(episodesUpdated).toBe(2)
    const state = await getState()
    expect(state.watchedEpisodes).toBe(2)
    expect(state.totalEpisodes).toBe(4)
    // Latest aired season (S2) is wholly unwatched → branch 4 fires
    expect(state.status).toBe('new_content')
  })

  it('marks watched=false clears progress', async () => {
    const { seasonIds } = await setup([{ episodeAirDates: [past(10), past(5)] }])

    await bulkUpdateEpisodeProgress(db, userId, showId, { watched: true })
    await bulkUpdateEpisodeProgress(db, userId, showId, { watched: false })

    const state = await getState()
    expect(state.watchedEpisodes).toBe(0)

    const eps = await db.select({ id: episodes.id }).from(episodes)
      .where(and(eq(episodes.showId, showId), eq(episodes.seasonId, seasonIds[0]!)))
    for (const ep of eps) {
      const p = await getProgress(ep.id)
      expect(p?.watched).toBe(false)
      expect(p?.watchedAt).toBeNull()
    }
  })

  it('throws SeasonNotFoundError when seasonId belongs to a different show', async () => {
    await setup([{ episodeAirDates: [past(5)] }])

    const fakeSeasonId = '00000000-0000-0000-0000-000000000001'
    await expect(
      bulkUpdateEpisodeProgress(db, userId, showId, { watched: true, seasonId: fakeSeasonId }),
    ).rejects.toThrow(SeasonNotFoundError)
  })

  it('returns episodesUpdated=0 when all episodes are in the future', async () => {
    await setup([{ episodeAirDates: [future(7), future(14)] }])

    const { episodesUpdated } = await bulkUpdateEpisodeProgress(db, userId, showId, { watched: true })

    expect(episodesUpdated).toBe(0)
    const state = await getState()
    expect(state.watchedEpisodes).toBe(0)
  })
})
