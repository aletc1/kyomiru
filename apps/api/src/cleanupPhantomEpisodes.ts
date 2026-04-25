import './loadEnv.js'
import { eq, inArray, sql } from 'drizzle-orm'
import { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import { createDbClient } from '@kyomiru/db/client'
import { episodes, seasons } from '@kyomiru/db/schema'
import { validateEnv } from './plugins/env.js'
import { createShowRefreshQueue, enqueueShowRefresh } from './workers/showRefreshWorker.js'
import { logger } from './util/logger.js'

/**
 * Detect and delete phantom duplicate episodes left over from an old catalog
 * shape that disagreed with TMDb/AniList. A phantom is an episode that:
 *   - has another episode in a higher-numbered season of the same show with
 *     the same normalized title (case/whitespace/smart-quote insensitive),
 *   - has no row in episode_providers,
 *   - has no row in user_episode_progress (stricter than "watched=false" —
 *     never delete a row a user has scrubbed into),
 *   - while the higher-season counterpart DOES have a provider mapping (i.e.
 *     it's the canonical row backed by an actual streaming entry).
 *
 * Modes:
 *   cleanup:phantom-eps --scan            list candidates (dry run)
 *   cleanup:phantom-eps --scan --apply    delete every flagged phantom
 *   cleanup:phantom-eps <showId> [--apply]  scope to one show
 */

interface PhantomRow {
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

async function findPhantoms(db: DbClient, showId: string | null): Promise<PhantomRow[]> {
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

async function deletePhantomsAndRefresh(
  db: DbClient,
  redis: Redis,
  phantoms: PhantomRow[],
): Promise<{ deleted: number; seasonsTouched: number; showsRefreshed: number }> {
  if (phantoms.length === 0) return { deleted: 0, seasonsTouched: 0, showsRefreshed: 0 }

  const phantomIds = phantoms.map((p) => p.phantom_id)
  const affectedShowIds = [...new Set(phantoms.map((p) => p.show_id))]

  let deleted = 0
  let seasonsTouched = 0

  await db.transaction(async (tx) => {
    // Capture affected season ids BEFORE delete so we can recompute their counts.
    const seasonRows = await tx
      .select({ seasonId: episodes.seasonId })
      .from(episodes)
      .where(inArray(episodes.id, phantomIds))
    const affectedSeasonIds = [...new Set(seasonRows.map((r) => r.seasonId))]

    const result = await tx.delete(episodes).where(inArray(episodes.id, phantomIds)).returning({ id: episodes.id })
    deleted = result.length

    if (affectedSeasonIds.length > 0) {
      await tx.update(seasons).set({
        episodeCount: sql`(SELECT COUNT(*)::int FROM ${episodes} WHERE ${episodes.seasonId} = ${seasons.id})`,
      }).where(inArray(seasons.id, affectedSeasonIds))
      seasonsTouched = affectedSeasonIds.length
    }
  })

  // Fan recompute out to all library users for each affected show.
  const showRefreshQueue = createShowRefreshQueue(redis)
  try {
    for (const sId of affectedShowIds) await enqueueShowRefresh(showRefreshQueue, sId)
  } finally {
    await showRefreshQueue.close()
  }

  return { deleted, seasonsTouched, showsRefreshed: affectedShowIds.length }
}

async function main() {
  const args = process.argv.slice(2)
  const scan = args.includes('--scan')
  const apply = args.includes('--apply')
  const showId = args.find((a) => !a.startsWith('--'))

  if (!scan && !showId) {
    console.error('Usage:')
    console.error('  cleanup:phantom-eps --scan            list phantom episodes (dry run)')
    console.error('  cleanup:phantom-eps --scan --apply    delete every flagged phantom')
    console.error('  cleanup:phantom-eps <showId> [--apply]  scope to one show')
    process.exit(1)
  }

  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })

  try {
    const phantoms = await findPhantoms(db, showId ?? null)

    if (phantoms.length === 0) {
      logger.info({ scope: showId ?? 'all' }, 'no phantom episodes found')
      return
    }

    const byShow = new Map<string, PhantomRow[]>()
    for (const p of phantoms) {
      const arr = byShow.get(p.show_id) ?? []
      arr.push(p)
      byShow.set(p.show_id, arr)
    }

    logger.info({ totalPhantoms: phantoms.length, shows: byShow.size }, 'phantom episodes detected')
    for (const [, group] of byShow) {
      const sample = group[0]!
      logger.info(
        {
          showId: sample.show_id,
          title: sample.show_title,
          phantomCount: group.length,
          example: `S${sample.phantom_season}E${sample.phantom_ep} "${sample.title}" matches S${sample.canonical_season}E${sample.canonical_ep}`,
        },
        'show phantoms',
      )
    }

    if (!apply) {
      logger.info('dry run — pass --apply to delete')
      return
    }

    const result = await deletePhantomsAndRefresh(db, redis, phantoms)
    logger.info(result, 'phantom cleanup complete')
  } finally {
    await redis.quit()
  }
}

void main().then(() => process.exit(0)).catch((err) => {
  logger.error({ err }, 'cleanup failed')
  process.exit(1)
})
