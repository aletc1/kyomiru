import '../loadEnv.js'
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { sql, inArray } from 'drizzle-orm'
import { createDbClient, type DbClient } from '@kyomiru/db/client'
import { shows } from '@kyomiru/db/schema'
import {
  isShowsExternalIdConflict,
  resolveExternalIds,
  withExternalIdRetry,
  SHOWS_TMDB_ID_INDEX,
  SHOWS_ANILIST_ID_INDEX,
} from '../services/enrichmentMerge.js'

const DATABASE_URL = process.env['DATABASE_URL']

describe('isShowsExternalIdConflict', () => {
  it('returns null for non-Postgres errors', () => {
    expect(isShowsExternalIdConflict(null)).toBeNull()
    expect(isShowsExternalIdConflict(new Error('boom'))).toBeNull()
    expect(isShowsExternalIdConflict({ code: '23505' })).toBeNull() // missing constraint_name
  })

  it('returns null for unrelated unique-constraint violations', () => {
    expect(isShowsExternalIdConflict({ code: '23505', constraint_name: 'users_email_idx' })).toBeNull()
  })

  it('detects shows_tmdb_id_idx conflict', () => {
    expect(isShowsExternalIdConflict({ code: '23505', constraint_name: 'shows_tmdb_id_idx' }))
      .toEqual({ kind: 'tmdb' })
  })

  it('detects shows_anilist_id_idx conflict', () => {
    expect(isShowsExternalIdConflict({ code: '23505', constraint_name: 'shows_anilist_id_idx' }))
      .toEqual({ kind: 'anilist' })
  })
})

describe('withExternalIdRetry', () => {
  it('returns immediately on success without retrying', async () => {
    let calls = 0
    await withExternalIdRetry(
      { tmdbId: null, anilistId: null },
      { tmdbId: 1, anilistId: 2 },
      async (ids) => { calls++; expect(ids).toEqual({ tmdbId: 1, anilistId: 2 }) },
    )
    expect(calls).toBe(1)
  })

  it('rethrows non-conflict errors without retry', async () => {
    let calls = 0
    await expect(withExternalIdRetry(
      { tmdbId: null, anilistId: null },
      { tmdbId: 1, anilistId: 2 },
      async () => { calls++; throw new Error('unrelated') },
    )).rejects.toThrow('unrelated')
    expect(calls).toBe(1)
  })

  it('rolls tmdbId back to current on tmdb conflict and retries once', async () => {
    const seen: Array<{ tmdbId: number | null; anilistId: number | null }> = []
    const onRace = vi.fn()
    await withExternalIdRetry(
      { tmdbId: null, anilistId: null },
      { tmdbId: 99, anilistId: 42 },
      async (ids) => {
        seen.push(ids)
        if (seen.length === 1) throw { code: '23505', constraint_name: 'shows_tmdb_id_idx' }
      },
      onRace,
    )
    expect(seen).toEqual([
      { tmdbId: 99, anilistId: 42 },
      { tmdbId: null, anilistId: 42 },
    ])
    expect(onRace).toHaveBeenCalledTimes(1)
    expect(onRace).toHaveBeenCalledWith({ kind: 'tmdb', attempt: 0 })
  })

  it('rolls anilistId back on anilist conflict', async () => {
    const seen: Array<{ tmdbId: number | null; anilistId: number | null }> = []
    await withExternalIdRetry(
      { tmdbId: 7, anilistId: 7 },
      { tmdbId: 99, anilistId: 42 },
      async (ids) => {
        seen.push(ids)
        if (seen.length === 1) throw { code: '23505', constraint_name: 'shows_anilist_id_idx' }
      },
    )
    expect(seen).toEqual([
      { tmdbId: 99, anilistId: 42 },
      { tmdbId: 99, anilistId: 7 },
    ])
  })

  it('handles successive races on both indexes', async () => {
    const seen: Array<{ tmdbId: number | null; anilistId: number | null }> = []
    await withExternalIdRetry(
      { tmdbId: null, anilistId: null },
      { tmdbId: 99, anilistId: 42 },
      async (ids) => {
        seen.push(ids)
        if (seen.length === 1) throw { code: '23505', constraint_name: 'shows_tmdb_id_idx' }
        if (seen.length === 2) throw { code: '23505', constraint_name: 'shows_anilist_id_idx' }
      },
    )
    expect(seen).toEqual([
      { tmdbId: 99, anilistId: 42 },
      { tmdbId: null, anilistId: 42 },
      { tmdbId: null, anilistId: null },
    ])
  })

  it('rethrows when the conflicting field already equals current (no progress possible)', async () => {
    let calls = 0
    await expect(withExternalIdRetry(
      { tmdbId: null, anilistId: null },
      { tmdbId: null, anilistId: 42 },
      async () => { calls++; throw { code: '23505', constraint_name: 'shows_tmdb_id_idx' } },
    )).rejects.toMatchObject({ code: '23505' })
    expect(calls).toBe(1)
  })
})

// Integration coverage for resolveExternalIds. Requires Postgres up
// (`pnpm db:up`); skipped otherwise so default `pnpm test` keeps running
// without infra.
describe.skipIf(!DATABASE_URL)('resolveExternalIds (DB)', () => {
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

  async function makeShow(opts: { tmdbId?: number; anilistId?: number; canonicalTitle?: string } = {}) {
    const suffix = Math.random().toString(36).slice(2, 10)
    const [row] = await db.insert(shows).values({
      canonicalTitle: opts.canonicalTitle ?? `Show ${suffix}`,
      titleNormalized: `show ${suffix}`,
      tmdbId: opts.tmdbId ?? null,
      anilistId: opts.anilistId ?? null,
    }).returning({ id: shows.id })
    createdShowIds.push(row!.id)
    return row!.id
  }

  it('shows table actually has the partial unique indexes whose names isShowsExternalIdConflict matches against', async () => {
    // If a future migration renames these indexes, withExternalIdRetry silently
    // stops working and the worker crashes on conflicts again.
    const rows = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'shows'
        AND indexname IN (${SHOWS_TMDB_ID_INDEX}, ${SHOWS_ANILIST_ID_INDEX})
    `)
    const found = new Set(rows.map((r) => r.indexname))
    expect(found.has(SHOWS_TMDB_ID_INDEX)).toBe(true)
    expect(found.has(SHOWS_ANILIST_ID_INDEX)).toBe(true)
  })

  it('returns proposed values when no other row holds them', async () => {
    const id = await makeShow()
    const result = await resolveExternalIds(
      db, id,
      { tmdbId: null, anilistId: null },
      { tmdbId: 100001, anilistId: 200001 },
    )
    expect(result).toEqual({ tmdbId: 100001, anilistId: 200001, conflicts: [] })
  })

  it('skips the SELECT when proposed equals current and returns the value unchanged', async () => {
    const id = await makeShow({ tmdbId: 100002 })
    const result = await resolveExternalIds(
      db, id,
      { tmdbId: 100002, anilistId: null },
      { tmdbId: 100002, anilistId: null },
    )
    expect(result).toEqual({ tmdbId: 100002, anilistId: null, conflicts: [] })
  })

  it('skips the SELECT when proposed is null', async () => {
    const id = await makeShow({ tmdbId: 100003 })
    const result = await resolveExternalIds(
      db, id,
      { tmdbId: 100003, anilistId: null },
      { tmdbId: null, anilistId: null },
    )
    // proposed.tmdbId === null → check skipped, value passes through.
    expect(result).toEqual({ tmdbId: null, anilistId: null, conflicts: [] })
  })

  it('falls back to current.tmdbId and surfaces the conflict when another show owns the proposed tmdbId', async () => {
    const otherId = await makeShow({ tmdbId: 100004, canonicalTitle: 'Other Show' })
    const id = await makeShow()
    const result = await resolveExternalIds(
      db, id,
      { tmdbId: null, anilistId: null },
      { tmdbId: 100004, anilistId: null },
    )
    expect(result.tmdbId).toBeNull()
    expect(result.anilistId).toBeNull()
    expect(result.conflicts).toEqual([
      { kind: 'tmdb', externalId: 100004, conflictingShowId: otherId, conflictingCanonicalTitle: 'Other Show' },
    ])
  })

  it('surfaces both tmdb and anilist conflicts independently', async () => {
    const tmdbOwner = await makeShow({ tmdbId: 100005, canonicalTitle: 'Tmdb Owner' })
    const anilistOwner = await makeShow({ anilistId: 200005, canonicalTitle: 'Anilist Owner' })
    const id = await makeShow()
    const result = await resolveExternalIds(
      db, id,
      { tmdbId: null, anilistId: null },
      { tmdbId: 100005, anilistId: 200005 },
    )
    expect(result.tmdbId).toBeNull()
    expect(result.anilistId).toBeNull()
    expect(result.conflicts).toHaveLength(2)
    expect(result.conflicts).toContainEqual({
      kind: 'tmdb', externalId: 100005, conflictingShowId: tmdbOwner, conflictingCanonicalTitle: 'Tmdb Owner',
    })
    expect(result.conflicts).toContainEqual({
      kind: 'anilist', externalId: 200005, conflictingShowId: anilistOwner, conflictingCanonicalTitle: 'Anilist Owner',
    })
  })

  it('does not flag the row itself as its own conflict', async () => {
    // If the row already holds the value (current === proposed), the SELECT is
    // skipped — verified above. But also: even if a stale `current` is passed
    // that differs from the row's actual value, the ne(shows.id, showId) clause
    // prevents self-collision when the value happens to be on the same row.
    const id = await makeShow({ tmdbId: 100006 })
    const result = await resolveExternalIds(
      db, id,
      { tmdbId: null, anilistId: null }, // pretend current is null even though row has 100006
      { tmdbId: 100006, anilistId: null },
    )
    expect(result.conflicts).toEqual([])
    expect(result.tmdbId).toBe(100006)
  })
})

