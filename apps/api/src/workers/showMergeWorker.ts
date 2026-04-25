import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import { mergeShows } from '../services/showMerge.js'
import { enqueueShowRefresh, type ShowRefreshJobData } from './showRefreshWorker.js'
import { logger } from '../util/logger.js'

export const SHOW_MERGE_QUEUE = 'showMerge'

export interface ShowMergeJobData {
  kind: 'tmdb' | 'anilist'
  externalId: number
  canonicalShowId: string
  duplicateShowId: string
}

const SHOW_MERGE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 1000 },
}

export function createShowMergeQueue(redis: Redis) {
  return new Queue<ShowMergeJobData>(SHOW_MERGE_QUEUE, { connection: redis })
}

/**
 * Enqueue a show-merge job. Job id is scoped to the (external id, duplicate
 * show id) pair so parallel enrichment conflicts for the same tmdb_id each get
 * their own job rather than collapsing. The advisory lock inside mergeShows
 * serialises concurrent execution against the same external id.
 */
export async function enqueueShowMerge(
  queue: Queue<ShowMergeJobData>,
  data: ShowMergeJobData,
): Promise<void> {
  const jobId = `merge-${data.kind}-${data.externalId}-${data.duplicateShowId}`
  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'completed' || state === 'failed') {
      await existing.remove().catch(() => {})
    }
  }
  await queue.add('merge', data, { jobId, ...SHOW_MERGE_JOB_OPTIONS })
}

export function createShowMergeWorker(
  db: DbClient,
  redis: Redis,
  showRefreshQueue: Queue<ShowRefreshJobData>,
  concurrency = 2,
) {
  const worker = new Worker<ShowMergeJobData>(
    SHOW_MERGE_QUEUE,
    async (job) => {
      const { kind, externalId, canonicalShowId, duplicateShowId } = job.data
      logger.info({ kind, externalId, canonicalShowId, duplicateShowId }, 'show merge job started')

      const result = await mergeShows(db, { kind, externalId, canonicalShowId, duplicateShowId })

      if (result.skipped) {
        logger.info({ kind, externalId, canonicalShowId, duplicateShowId }, 'show merge skipped — already merged or shows not found')
        return
      }

      await enqueueShowRefresh(showRefreshQueue, canonicalShowId)
    },
    {
      connection: redis,
      concurrency,
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  )

  const q = SHOW_MERGE_QUEUE
  worker.on('completed', (job) =>
    logger.info({ q, jobId: job.id, kind: job.data.kind, externalId: job.data.externalId, ms: Date.now() - (job.processedOn ?? Date.now()) }, 'job completed'),
  )
  worker.on('failed', (job, err) =>
    logger.error({ q, jobId: job?.id, kind: job?.data.kind, externalId: job?.data.externalId, attempts: job?.attemptsMade, err }, 'job failed'),
  )
  worker.on('stalled', (jobId) =>
    logger.warn({ q, jobId }, 'job stalled — lock expired, will retry'),
  )
  worker.on('error', (err) =>
    logger.error({ q, err }, 'worker error'),
  )

  return worker
}
