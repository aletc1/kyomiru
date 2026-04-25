import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { Redis } from 'ioredis'
import { and, eq, isNotNull, inArray } from 'drizzle-orm'
import { shows } from '@kyomiru/db/schema'
import { createEnrichmentQueue, enqueueEnrichment } from './workers/enrichmentWorker.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

const BATCH_SIZE = 500

async function backfill() {
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = createEnrichmentQueue(redis)

  // Target shows currently classified as 'tv' that have already been enriched —
  // those are the ones the 7-day freshness short-circuit would otherwise keep
  // misclassified. Shows with enrichedAt IS NULL are already pending in the
  // natural enrichment flow (cron:run picks them up).
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.kind, 'tv'), isNotNull(shows.enrichedAt)))

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const ids = rows.slice(i, i + BATCH_SIZE).map((r) => r.id)
    await db.update(shows)
      .set({ enrichedAt: null })
      .where(inArray(shows.id, ids))
  }

  for (const row of rows) {
    await enqueueEnrichment(queue, row.id)
  }

  logger.info(`Enqueued ${rows.length} tv-kind shows for reclassification backfill`)

  await queue.close()
  await redis.quit()
}

backfill().catch((err) => {
  logger.error(err)
  process.exit(1)
})
