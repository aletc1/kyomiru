import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { Redis } from 'ioredis'
import { createEnrichmentQueue, enqueuePendingEnrichment } from './workers/enrichmentWorker.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

async function runCron() {
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const enrichmentQueue = createEnrichmentQueue(redis)

  const enrichmentCount = await enqueuePendingEnrichment(db, enrichmentQueue)
  logger.info(`Enqueued ${enrichmentCount} enrichment jobs`)

  await enrichmentQueue.close()
  await redis.quit()
}

runCron().catch((err) => {
  logger.error(err)
  process.exit(1)
})
