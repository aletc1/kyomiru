import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { Redis } from 'ioredis'
import { and, inArray, isNotNull } from 'drizzle-orm'
import { shows } from '@kyomiru/db/schema'
import { createEnrichmentQueue, enqueuePendingEnrichment, enqueueEnrichment } from './workers/enrichmentWorker.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

const BATCH_SIZE = 500

async function backfill() {
  const force = process.argv.includes('--force')
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = createEnrichmentQueue(redis)

  if (force) {
    const rows = await db.select({ id: shows.id }).from(shows)

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const ids = rows.slice(i, i + BATCH_SIZE).map((r) => r.id)
      await db.update(shows)
        .set({ enrichedAt: null })
        .where(and(inArray(shows.id, ids), isNotNull(shows.enrichedAt)))
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map((r) => enqueueEnrichment(queue, r.id)))
    }

    logger.info(`Enqueued ${rows.length} enrichment jobs (--force, all shows)`)
  } else {
    const count = await enqueuePendingEnrichment(db, queue)
    logger.info(`Enqueued ${count} enrichment jobs (pending only)`)
  }

  await queue.close()
  await redis.quit()
}

backfill().catch((err) => {
  logger.error(err)
  process.exit(1)
})
