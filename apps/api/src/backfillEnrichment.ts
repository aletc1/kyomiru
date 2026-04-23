import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { Redis } from 'ioredis'
import { createEnrichmentQueue, enqueuePendingEnrichment } from './workers/enrichmentWorker.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

async function backfill() {
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = createEnrichmentQueue(redis)

  const count = await enqueuePendingEnrichment(db, queue)
  logger.info(`Enqueued ${count} enrichment jobs`)

  await queue.close()
  await redis.quit()
}

backfill().catch((err) => {
  logger.error(err)
  process.exit(1)
})
