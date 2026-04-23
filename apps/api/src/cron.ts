import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { eq } from 'drizzle-orm'
import { userServices } from '@kyomiru/db/schema'
import type { SyncJobData } from './workers/syncWorker.js'
import { SYNC_QUEUE } from './workers/syncWorker.js'
import { createEnrichmentQueue, enqueuePendingEnrichment } from './workers/enrichmentWorker.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

async function runCron() {
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = new Queue<SyncJobData>(SYNC_QUEUE, { connection: redis })
  const enrichmentQueue = createEnrichmentQueue(redis)

  const connected = await db.select().from(userServices).where(eq(userServices.status, 'connected'))

  const now = new Date()
  const dateKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}`

  for (const svc of connected) {
    await queue.add(
      'sync',
      { userId: svc.userId, providerKey: svc.providerKey, trigger: 'cron' },
      { jobId: `cron-${svc.userId}-${svc.providerKey}-${dateKey}` },
    )
  }

  logger.info(`Enqueued ${connected.length} sync jobs`)

  const enrichmentCount = await enqueuePendingEnrichment(db, enrichmentQueue)
  logger.info(`Enqueued ${enrichmentCount} enrichment jobs`)

  await queue.close()
  await enrichmentQueue.close()
  await redis.quit()
}

runCron().catch((err) => {
  logger.error(err)
  process.exit(1)
})
