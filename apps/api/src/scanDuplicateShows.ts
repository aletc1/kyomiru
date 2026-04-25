/**
 * Safety-net script: re-enqueues enrichment for shows that were enriched at
 * least once but ended up with no tmdb_id. These are the candidates where an
 * earlier enrichment run found a TMDB match but skipped the id write because
 * another show already claimed it (duplicate row). Re-running enrichment forces
 * the conflict-detection path again, which now triggers a merge job.
 *
 * The 7-day freshness short-circuit in the enrichment worker would otherwise
 * skip these shows indefinitely. We reset `enrichedAt` so the worker re-checks.
 *
 * Run via: pnpm -F @kyomiru/api merge:scan [--force]
 * Schedule: daily, after `cron:run`.
 *
 * `--force` bypasses the 5-attempt retry cap for one-off rescans.
 */
import './loadEnv.js'
import { and, isNull, isNotNull, inArray, lt } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { createDbClient } from '@kyomiru/db/client'
import { shows } from '@kyomiru/db/schema'
import { createEnrichmentQueue, enqueueEnrichment } from './workers/enrichmentWorker.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

const BATCH_SIZE = 500
// Skip shows that have already exhausted enrichment retries — re-running them
// daily would just keep failing for shows with no real TMDB match.
const MAX_ENRICHMENT_ATTEMPTS = 5

async function main() {
  const force = process.argv.includes('--force')
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = createEnrichmentQueue(redis)

  // Shows enriched at least once but without a tmdb_id are the primary duplicate
  // candidates. Anime shows with no anilist_id could also be duplicates but
  // re-enriching them without a TMDB key is a no-op anyway. Skip shows whose
  // enrichment attempts already exceeded the retry budget (unless --force).
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(
      isNotNull(shows.enrichedAt),
      isNull(shows.tmdbId),
      ...(force ? [] : [lt(shows.enrichmentAttempts, MAX_ENRICHMENT_ATTEMPTS)]),
    ))

  logger.info(`Found ${rows.length} candidate shows (enriched but no tmdb_id)${force ? ' (--force, ignoring attempts cap)' : ''}`)

  if (rows.length === 0) {
    await queue.close()
    await redis.quit()
    return
  }

  // Reset enrichedAt in batches so the enrichment worker re-runs instead of
  // short-circuiting on the 7-day freshness check.
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const ids = rows.slice(i, i + BATCH_SIZE).map((r) => r.id)
    await db.update(shows)
      .set({ enrichedAt: null })
      .where(inArray(shows.id, ids))
    logger.info(`Reset enrichedAt for batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}`)
  }

  // Batch the enqueues with Promise.all so the Redis round-trips overlap.
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map((r) => enqueueEnrichment(queue, r.id)))
  }

  logger.info(`Enqueued ${rows.length} enrichment jobs for duplicate-scan`)

  await queue.close()
  await redis.quit()
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
