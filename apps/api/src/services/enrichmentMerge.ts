import { and, eq, ne } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import { shows } from '@kyomiru/db/schema'

export interface ExternalIdConflict {
  kind: 'tmdb' | 'anilist'
  externalId: number
  conflictingShowId: string
  conflictingCanonicalTitle: string
}

export interface ResolvedExternalIds {
  tmdbId: number | null
  anilistId: number | null
  conflicts: ExternalIdConflict[]
}

/**
 * Checks whether the proposed tmdb_id / anilist_id would violate the partial
 * unique indexes on shows. When another row already holds the proposed id the
 * field is left at its current value and the conflict is surfaced so the caller
 * can log a warning or tell the operator about the duplicate show row.
 */
export async function resolveExternalIds(
  db: DbClient,
  showId: string,
  current: { tmdbId: number | null; anilistId: number | null },
  proposed: { tmdbId: number | null; anilistId: number | null },
): Promise<ResolvedExternalIds> {
  const conflicts: ExternalIdConflict[] = []
  let tmdbId = proposed.tmdbId
  let anilistId = proposed.anilistId

  if (proposed.tmdbId !== null && proposed.tmdbId !== current.tmdbId) {
    const [conflict] = await db
      .select({ id: shows.id, canonicalTitle: shows.canonicalTitle })
      .from(shows)
      .where(and(eq(shows.tmdbId, proposed.tmdbId), ne(shows.id, showId)))
    if (conflict) {
      conflicts.push({
        kind: 'tmdb',
        externalId: proposed.tmdbId,
        conflictingShowId: conflict.id,
        conflictingCanonicalTitle: conflict.canonicalTitle,
      })
      tmdbId = current.tmdbId
    }
  }

  if (proposed.anilistId !== null && proposed.anilistId !== current.anilistId) {
    const [conflict] = await db
      .select({ id: shows.id, canonicalTitle: shows.canonicalTitle })
      .from(shows)
      .where(and(eq(shows.anilistId, proposed.anilistId), ne(shows.id, showId)))
    if (conflict) {
      conflicts.push({
        kind: 'anilist',
        externalId: proposed.anilistId,
        conflictingShowId: conflict.id,
        conflictingCanonicalTitle: conflict.canonicalTitle,
      })
      anilistId = current.anilistId
    }
  }

  return { tmdbId, anilistId, conflicts }
}

/**
 * Detect a unique-constraint violation on shows_tmdb_id_idx / shows_anilist_id_idx.
 * Returned when another writer claimed the id between resolveExternalIds and
 * the subsequent UPDATE. postgres-js exposes `code` (SQLSTATE) and
 * `constraint_name` on PostgresError instances.
 *
 * Index names are defined in packages/db/src/migrations/0003_show_enrichment_columns.sql.
 * If those names ever change, the SHOWS_EXTERNAL_ID_INDEXES test in
 * enrichmentMerge.test.ts will fail loudly against a real database.
 */
export const SHOWS_TMDB_ID_INDEX = 'shows_tmdb_id_idx'
export const SHOWS_ANILIST_ID_INDEX = 'shows_anilist_id_idx'

export function isShowsExternalIdConflict(err: unknown): { kind: 'tmdb' | 'anilist' } | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { code?: string; constraint_name?: string }
  if (e.code !== '23505') return null
  if (e.constraint_name === SHOWS_TMDB_ID_INDEX) return { kind: 'tmdb' }
  if (e.constraint_name === SHOWS_ANILIST_ID_INDEX) return { kind: 'anilist' }
  return null
}

/**
 * Run the supplied UPDATE under the protection of the partial unique indexes
 * on shows.tmdb_id / shows.anilist_id. If a concurrent writer claims either id
 * between resolveExternalIds and the UPDATE (TOCTOU), the racing field is
 * rolled back to its `current` value and the UPDATE is retried. Bounded to two
 * retries (one per index) before giving up.
 */
export async function withExternalIdRetry<T>(
  current: { tmdbId: number | null; anilistId: number | null },
  initial: { tmdbId: number | null; anilistId: number | null },
  attempt: (ids: { tmdbId: number | null; anilistId: number | null }) => Promise<T>,
  onRace?: (info: { kind: 'tmdb' | 'anilist'; attempt: number }) => void,
): Promise<T> {
  let tmdbId = initial.tmdbId
  let anilistId = initial.anilistId
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt({ tmdbId, anilistId })
    } catch (err) {
      const raced = isShowsExternalIdConflict(err)
      if (!raced) throw err
      onRace?.({ kind: raced.kind, attempt: i })
      if (raced.kind === 'tmdb') {
        if (tmdbId === current.tmdbId) throw err
        tmdbId = current.tmdbId
      } else {
        if (anilistId === current.anilistId) throw err
        anilistId = current.anilistId
      }
    }
  }
  throw new Error('withExternalIdRetry: exceeded attempts')
}
