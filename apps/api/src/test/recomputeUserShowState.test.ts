import '../loadEnv.js'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDbClient, type DbClient } from '@kyomiru/db/client'
import {
  episodes, episodeProviders, providers, seasons, shows, users, userEpisodeProgress, userShowState,
} from '@kyomiru/db/schema'
import { recomputeUserShowState } from '../services/stateMachine.js'

// Integration coverage for the aired-episode filter. Requires Postgres up
// (`pnpm db:up`); skipped otherwise so default `pnpm test` keeps running
// without infra.
const DATABASE_URL = process.env['DATABASE_URL']

describe.skipIf(!DATABASE_URL)('recomputeUserShowState (DB)', () => {
  let db: DbClient
  let userId: string
  let showId: string

  beforeAll(() => {
    db = createDbClient(DATABASE_URL!)
  })

  afterAll(async () => {
    // postgres-js client doesn't expose .end() on the drizzle wrapper, but the
    // process exits at vitest teardown so connection cleanup is implicit.
  })

  afterEach(async () => {
    // user cascades to user_show_state + user_episode_progress; show cascades
    // to seasons + episodes + episode_providers.
    if (userId) await db.delete(users).where(eq(users.id, userId))
    if (showId) await db.delete(shows).where(eq(shows.id, showId))
  })

  async function setup(opts: {
    episodeAirDates: (string | null)[]
    watchedIndices?: number[]
    // Episode indices that should get an episode_providers row. Used to
    // simulate extension-fallback NULL eps (which carry a provider link)
    // versus enrichment-placeholder NULLs (which do not).
    providerLinkedIndices?: number[]
    initialStatus?: 'in_progress' | 'watched' | 'new_content' | 'coming_soon'
    initialTotal?: number
  }) {
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

    const [season] = await db.insert(seasons).values({
      showId,
      seasonNumber: 1,
      episodeCount: opts.episodeAirDates.length,
    }).returning({ id: seasons.id })
    const seasonId = season!.id

    const epRows = opts.episodeAirDates.length === 0
      ? []
      : await db.insert(episodes).values(
          opts.episodeAirDates.map((airDate, i) => ({
            seasonId,
            showId,
            episodeNumber: i + 1,
            airDate,
          })),
        ).returning({ id: episodes.id, episodeNumber: episodes.episodeNumber })

    if (opts.watchedIndices?.length) {
      await db.insert(userEpisodeProgress).values(
        opts.watchedIndices.map((i) => ({
          userId,
          episodeId: epRows[i]!.id,
          watched: true,
          watchedAt: new Date(),
          lastEventAt: new Date(),
        })),
      )
    }

    if (opts.providerLinkedIndices?.length) {
      await db.insert(providers).values({ key: 'netflix', displayName: 'Netflix' })
        .onConflictDoNothing()
      await db.insert(episodeProviders).values(
        opts.providerLinkedIndices.map((i) => ({
          episodeId: epRows[i]!.id,
          providerKey: 'netflix',
          externalId: `${suffix}-${i}`,
        })),
      )
    }

    await db.insert(userShowState).values({
      userId,
      showId,
      status: opts.initialStatus ?? 'in_progress',
      totalEpisodes: opts.initialTotal ?? 0,
      watchedEpisodes: opts.watchedIndices?.length ?? 0,
    })
  }

  async function readState() {
    const [row] = await db.select().from(userShowState)
      .where(eq(userShowState.userId, userId))
    return row!
  }

  // helpers — past = aired, future = unaired
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

  it('counts only aired episodes toward total; coming_soon when future eps are scheduled', async () => {
    // 3 aired + 9 future, all 3 aired watched → 3/3 watched, hasUpcoming → coming_soon.
    await setup({
      episodeAirDates: [
        past(30), past(20), past(10),
        future(7), future(14), future(21), future(28), future(35),
        future(42), future(49), future(56), future(63),
      ],
      watchedIndices: [0, 1, 2],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(3)
    expect(state.watchedEpisodes).toBe(3)
    expect(state.status).toBe('coming_soon')
  })

  it('treats provider-linked null air_date as aired (extension-only fallback)', async () => {
    // Netflix history-only: episodes are written with NULL air_date AND an
    // episode_providers row. Those NULLs are watched-but-undated, not upcoming.
    await setup({
      episodeAirDates: [null, null, null],
      watchedIndices: [0, 1],
      providerLinkedIndices: [0, 1, 2],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(3)
    expect(state.watchedEpisodes).toBe(2)
    expect(state.status).toBe('in_progress')
  })

  it('treats unwatched null-air-date enrichment placeholder as upcoming → coming_soon', async () => {
    // TSUKIMICHI shape: all dated released eps watched, plus a NULL placeholder
    // (announced future season, no schedule yet) with no episode_providers row.
    // T>W due to the placeholder; nothing is actionable today; the placeholder
    // counts as upcoming → CS branch fires.
    await setup({
      episodeAirDates: [past(30), past(20), past(10), null],
      watchedIndices: [0, 1, 2],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(4)
    expect(state.watchedEpisodes).toBe(3)
    expect(state.status).toBe('coming_soon')
  })

  it('today counts as aired (CURRENT_DATE inclusive); coming_soon when a future ep is also scheduled', async () => {
    const today = new Date().toISOString().slice(0, 10)
    await setup({
      episodeAirDates: [past(7), today, future(7)],
      watchedIndices: [0, 1],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(2) // past + today
    expect(state.watchedEpisodes).toBe(2)
    // hasUpcoming=true (future(7)) → coming_soon, not watched
    expect(state.status).toBe('coming_soon')
  })

  it('flips watched → new_content when a future episode crosses CURRENT_DATE', async () => {
    // Initial: 3 aired all watched. Stored state reflects this.
    await setup({
      episodeAirDates: [past(30), past(20), past(10), future(5)],
      watchedIndices: [0, 1, 2],
      initialStatus: 'watched',
      initialTotal: 3,
    })

    // Day 1: episode 4 still future → hasUpcoming=true, W==T for aired → coming_soon.
    await recomputeUserShowState(db, userId, showId)
    expect((await readState()).status).toBe('coming_soon')

    // Simulate the air date passing: flip episode 4 to past(0).
    await db.update(episodes)
      .set({ airDate: past(0) })
      .where(eq(episodes.episodeNumber, 4))

    await recomputeUserShowState(db, userId, showId)
    const state = await readState()
    expect(state.totalEpisodes).toBe(4)
    expect(state.watchedEpisodes).toBe(3)
    expect(state.status).toBe('new_content')
  })

  it('does not flip an unenriched (total=0) show to watched', async () => {
    await setup({
      episodeAirDates: [],
      watchedIndices: [],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(0)
    expect(state.watchedEpisodes).toBe(0)
    expect(state.status).toBe('in_progress')
  })

  // ── whole-season new_content rule ────────────────────────────────────────────

  async function setupMultiSeason(opts: {
    seasonEpisodes: { airDates: (string | null)[]; watchedIndices?: number[] }[]
    initialStatus?: 'in_progress' | 'watched' | 'new_content' | 'coming_soon'
    initialTotal?: number
  }) {
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

    for (let sIdx = 0; sIdx < opts.seasonEpisodes.length; sIdx++) {
      const { airDates, watchedIndices = [] } = opts.seasonEpisodes[sIdx]!

      const [season] = await db.insert(seasons).values({
        showId,
        seasonNumber: sIdx + 1,
        episodeCount: airDates.length,
      }).returning({ id: seasons.id })
      const seasonId = season!.id

      if (airDates.length === 0) continue

      const epRows = await db.insert(episodes).values(
        airDates.map((airDate, i) => ({
          seasonId,
          showId,
          episodeNumber: i + 1,
          airDate,
        })),
      ).returning({ id: episodes.id })

      if (watchedIndices.length) {
        await db.insert(userEpisodeProgress).values(
          watchedIndices.map((i) => ({
            userId,
            episodeId: epRows[i]!.id,
            watched: true,
            watchedAt: new Date(),
            lastEventAt: new Date(),
          })),
        )
      }
    }

    await db.insert(userShowState).values({
      userId,
      showId,
      status: opts.initialStatus ?? 'in_progress',
      totalEpisodes: opts.initialTotal ?? 0,
      watchedEpisodes: opts.seasonEpisodes.reduce(
        (sum, s) => sum + (s.watchedIndices?.length ?? 0), 0,
      ),
    })
  }

  it('flips in_progress to new_content when the latest aired season is unwatched and user has started the show', async () => {
    // S1: 12 aired, user watches episode 1. S2: 12 aired, all unwatched (latest season).
    await setupMultiSeason({
      seasonEpisodes: [
        { airDates: Array.from({ length: 12 }, (_, i) => past(30 + i)), watchedIndices: [0] },
        { airDates: Array.from({ length: 12 }, (_, i) => past(i + 1)) },
      ],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(24)
    expect(state.watchedEpisodes).toBe(1)
    expect(state.status).toBe('new_content')
  })

  it('stays in_progress when user has started every season (no whole-season skip)', async () => {
    // S1: 12 aired, user watched 1. S2: 12 aired, user watched 1. No whole-skip.
    await setupMultiSeason({
      seasonEpisodes: [
        { airDates: Array.from({ length: 12 }, (_, i) => past(20 + i)), watchedIndices: [0] },
        { airDates: Array.from({ length: 12 }, (_, i) => past(i + 1)), watchedIndices: [0] },
      ],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.status).toBe('in_progress')
  })

  it('does NOT fire latest-season rule when user has watched nothing at all', async () => {
    // S1 and S2 both fully unwatched — user never engaged.
    await setupMultiSeason({
      seasonEpisodes: [
        { airDates: Array.from({ length: 12 }, (_, i) => past(20 + i)) },
        { airDates: Array.from({ length: 12 }, (_, i) => past(i + 1)) },
      ],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.status).toBe('in_progress')
  })

  it('does NOT count future-only seasons as whole unwatched (they are not aired yet)', async () => {
    // S1: 12 aired, user watches 1. S2: 12 future — should not trigger rule.
    await setupMultiSeason({
      seasonEpisodes: [
        { airDates: Array.from({ length: 12 }, (_, i) => past(i + 1)), watchedIndices: [0] },
        { airDates: Array.from({ length: 12 }, (_, i) => future(i + 7)) },
      ],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.status).toBe('in_progress')
  })

  it('does NOT fire when only an early season is wholly skipped but the latest has progress', async () => {
    // S1: 12 aired, all unwatched. S2 (latest): 12 aired, user watches episode 1.
    // Old rule would fire (S1 is a whole unwatched season); new rule does not (latest is touched).
    await setupMultiSeason({
      seasonEpisodes: [
        { airDates: Array.from({ length: 12 }, (_, i) => past(30 + i)) },
        { airDates: Array.from({ length: 12 }, (_, i) => past(i + 1)), watchedIndices: [0] },
      ],
    })

    await recomputeUserShowState(db, userId, showId)

    const state = await readState()
    expect(state.totalEpisodes).toBe(24)
    expect(state.watchedEpisodes).toBe(1)
    expect(state.status).toBe('in_progress')
  })
})
