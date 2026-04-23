import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import { syncRuns } from '@kyomiru/db/schema'
import type { Provider } from '@kyomiru/providers/types'
import { runSync } from '../services/sync.service.js'
import type { EnrichmentJobData } from './enrichmentWorker.js'
import { logger } from '../util/logger.js'

export const SYNC_QUEUE = 'sync'

export interface SyncJobData {
  userId: string
  providerKey: string
  trigger: 'manual' | 'cron'
}

const PROVIDER_MAP: Record<string, Provider> = {}

export function createSyncQueue(redis: Redis) {
  return new Queue<SyncJobData>(SYNC_QUEUE, {
    connection: redis,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  })
}

export function createSyncWorker(
  db: DbClient,
  redis: Redis,
  secretKey: string,
  enrichmentQueue: Queue<EnrichmentJobData>,
) {
  return new Worker<SyncJobData>(
    SYNC_QUEUE,
    async (job) => {
      const { userId, providerKey, trigger } = job.data
      logger.info({ userId, providerKey, trigger }, 'Sync job started')

      // Create sync_runs row
      const [run] = await db.insert(syncRuns).values({
        userId,
        providerKey,
        trigger,
        status: 'running',
      }).returning({ id: syncRuns.id })

      if (!run) throw new Error('Failed to create sync run')

      const provider = PROVIDER_MAP[providerKey]
      if (!provider) throw new Error(`Unknown provider: ${providerKey}`)

      await runSync(db, userId, providerKey, provider, secretKey, run.id, enrichmentQueue)
    },
    {
      connection: redis,
      concurrency: 5,
    },
  )
}
