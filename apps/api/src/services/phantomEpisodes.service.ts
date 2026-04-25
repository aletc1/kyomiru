import { and, inArray, notExists, sql } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import { episodeProviders, episodes, seasons, userEpisodeProgress } from '@kyomiru/db/schema'

export interface PhantomRow {
  phantom_id: string
  show_id: string
  phantom_season: number
  phantom_ep: number
  canonical_season: number
  canonical_ep: number
  title: string
  show_title: string
}

// Smart-quote and ASCII-quote stripping. Catches Frieren-style "Himmel's"
// (curly apostrophe U+2019) vs "Himmel's" (ASCII) drift.
const NORMALIZED_TITLE = sql`
  lower(btrim(translate(
    coalesce(title, ''),
    chr(8216) || chr(8217) || chr(8220) || chr(8221) || '''"',
    ''
  )))
`

// Trigram similarity threshold (pg_trgm is enabled in migration 0012). Catches
// the Shangri-La case where the phantom is "Embrace the Lamplight of Ambition (1)"
// and the canonical is "Embrace the Lamplight of Ambition, Part 1" (sim ≈ 0.88),
// while staying above the noise floor for genuinely different titles. Placeholder
// titles ("Episode N", "Episodio N", "第N話") are excluded from BOTH match paths
// because they generate false positives ("Episode 20" sim 0.75 vs "Episode 2",
// and a show with placeholder-only titles like Tales of Wedding Rings would get
// every episode in S1 cross-matched with every episode in S2).
const FUZZY_THRESHOLD = 0.7
// Tagged template literal cooks `\s` → `s`, so escape backslashes for the
// resulting SQL regex to read `\s` / `\d`.
const PLACEHOLDER_RE = sql`'^\\s*(episod[eo]\\s*\\d+|第\\s*\\d+\\s*話)\\s*$'`

export async function findPhantoms(db: DbClient, showId: string | null): Promise<PhantomRow[]> {
  const rows = await db.execute(sql`
    WITH norm AS (
      SELECT e.id, e.show_id, e.season_id, e.episode_number, e.title,
             ${NORMALIZED_TITLE} AS title_norm,
             coalesce(title, '') ~* ${PLACEHOLDER_RE} AS is_placeholder
      FROM ${episodes} e
      ${showId ? sql`WHERE e.show_id = ${showId}` : sql``}
    ),
    pairs AS (
      SELECT DISTINCT ON (e1.id)
        e1.id            AS phantom_id,
        e1.show_id       AS show_id,
        e1.season_id     AS phantom_season_id,
        e1.episode_number AS phantom_ep,
        e2.id            AS canonical_id,
        e2.season_id     AS canonical_season_id,
        e2.episode_number AS canonical_ep,
        e1.title         AS title
      FROM norm e1
      JOIN norm e2 ON e2.show_id = e1.show_id AND e2.id <> e1.id
                  AND length(e1.title_norm) > 0
                  AND NOT e1.is_placeholder
                  AND NOT e2.is_placeholder
                  AND (
                    e2.title_norm = e1.title_norm
                    OR similarity(e1.title, e2.title) >= ${FUZZY_THRESHOLD}
                  )
      WHERE NOT EXISTS (SELECT 1 FROM episode_providers ep      WHERE ep.episode_id = e1.id)
        AND NOT EXISTS (SELECT 1 FROM user_episode_progress uep WHERE uep.episode_id = e1.id)
        AND     EXISTS (SELECT 1 FROM episode_providers ep      WHERE ep.episode_id = e2.id)
        -- The phantom's OWN season must have at least one *other* episode with
        -- a provider mapping. This proves the season was catalog-fetched (e.g.
        -- Crunchyroll wrote rows for the season) and the phantom is an anomaly
        -- *within* that catalog, not an unwatched-but-real episode in a season
        -- that was never catalogued (Netflix-style: "St. Lucifer" S1E11 is
        -- legitimately unwatched, not a phantom of S5E2).
        AND EXISTS (
          SELECT 1 FROM episode_providers ep3
          JOIN episodes e3 ON e3.id = ep3.episode_id
          WHERE e3.season_id = e1.season_id AND e3.id <> e1.id
        )
      ORDER BY e1.id,
               CASE WHEN e2.title_norm = e1.title_norm THEN 0 ELSE 1 END,  -- exact match wins
               similarity(e1.title, e2.title) DESC
    )
    SELECT p.phantom_id, p.show_id,
           s1.season_number AS phantom_season, p.phantom_ep,
           s2.season_number AS canonical_season, p.canonical_ep,
           p.title, sh.canonical_title AS show_title
    FROM pairs p
    JOIN seasons s1 ON s1.id = p.phantom_season_id
    JOIN seasons s2 ON s2.id = p.canonical_season_id
    JOIN shows   sh ON sh.id = p.show_id
    WHERE s1.season_number < s2.season_number
    ORDER BY sh.canonical_title, s1.season_number, p.phantom_ep
  `)
  return rows as unknown as PhantomRow[]
}

export async function deletePhantoms(
  db: DbClient,
  phantoms: PhantomRow[],
): Promise<{ deleted: number; seasonsTouched: number; affectedShowIds: string[] }> {
  if (phantoms.length === 0) return { deleted: 0, seasonsTouched: 0, affectedShowIds: [] }

  const phantomIds = phantoms.map((p) => p.phantom_id)
  const affectedShowIds = [...new Set(phantoms.map((p) => p.show_id))]

  let deleted = 0
  let seasonsTouched = 0

  await db.transaction(async (tx) => {
    // Defense-in-depth: re-check the no-provider / no-progress predicates inside
    // the transaction. findPhantoms ran outside any lock, and a concurrent sync
    // ingest could have written a provider mapping or user progress for one of
    // the candidates between the find and this delete. RETURNING season_id so
    // we recompute episode_count only for seasons whose phantoms actually went.
    const result = await tx.delete(episodes).where(and(
      inArray(episodes.id, phantomIds),
      notExists(
        tx.select({ one: sql`1` }).from(episodeProviders)
          .where(sql`${episodeProviders.episodeId} = ${episodes.id}`),
      ),
      notExists(
        tx.select({ one: sql`1` }).from(userEpisodeProgress)
          .where(sql`${userEpisodeProgress.episodeId} = ${episodes.id}`),
      ),
    )).returning({ id: episodes.id, seasonId: episodes.seasonId })
    deleted = result.length

    const affectedSeasonIds = [...new Set(result.map((r) => r.seasonId))]
    if (affectedSeasonIds.length > 0) {
      await tx.update(seasons).set({
        episodeCount: sql`(SELECT COUNT(*)::int FROM ${episodes} WHERE ${episodes.seasonId} = ${seasons.id})`,
      }).where(inArray(seasons.id, affectedSeasonIds))
      seasonsTouched = affectedSeasonIds.length
    }
  })

  return { deleted, seasonsTouched, affectedShowIds }
}

/**
 * Find + delete phantoms for a single show. Does NOT enqueue a showRefresh —
 * callers running inside the enrichment worker already enqueue one of their
 * own; the standalone CLI in cleanupPhantomEpisodes.ts handles the queue
 * lifecycle itself.
 */
export async function cleanupPhantomsForShow(
  db: DbClient,
  showId: string,
): Promise<{ deleted: number; seasonsTouched: number }> {
  const phantoms = await findPhantoms(db, showId)
  const { deleted, seasonsTouched } = await deletePhantoms(db, phantoms)
  return { deleted, seasonsTouched }
}
