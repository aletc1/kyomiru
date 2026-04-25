import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import { eq, ne, and, sql } from 'drizzle-orm'
import { shows, episodes, userShowState } from '@kyomiru/db/schema'
import { recomputeUserShowState } from '../services/stateMachine.js'
import { logger } from '../util/logger.js'

export const SHOW_REFRESH_QUEUE = 'showRefresh'

export interface ShowRefreshJobData {
  showId: string
}

const SHOW_REFRESH_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 1000 },
}

export function createShowRefreshQueue(redis: Redis) {
  return new Queue<ShowRefreshJobData>(SHOW_REFRESH_QUEUE, { connection: redis })
}

export async function enqueueShowRefresh(
  queue: Queue<ShowRefreshJobData>,
  showId: string,
): Promise<void> {
  const jobId = `refresh-${showId}`
  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'completed' || state === 'failed') {
      await existing.remove().catch(() => {})
    }
  }
  await queue.add('refresh', { showId }, { jobId, ...SHOW_REFRESH_JOB_OPTIONS })
}

async function refreshLatestAirDate(db: DbClient, showId: string): Promise<void> {
  const [row] = await db
    .select({ latest: sql<string | null>`MAX(${episodes.airDate})` })
    .from(episodes)
    .where(eq(episodes.showId, showId))
  if (row?.latest) {
    await db.update(shows).set({ latestAirDate: row.latest }).where(eq(shows.id, showId))
  }
}

export function createShowRefreshWorker(db: DbClient, redis: Redis, concurrency = 3) {
  const worker = new Worker<ShowRefreshJobData>(
    SHOW_REFRESH_QUEUE,
    async (job) => {
      const { showId } = job.data
      logger.info({ showId }, `refreshing show state ${showId}`)

      await refreshLatestAirDate(db, showId)

      const libraryRows = await db
        .select({ userId: userShowState.userId })
        .from(userShowState)
        .where(and(eq(userShowState.showId, showId), ne(userShowState.status, 'removed')))

      for (const { userId } of libraryRows) {
        await recomputeUserShowState(db, userId, showId)
      }

      logger.info({ showId, users: libraryRows.length }, `refreshed show state ${showId}`)
    },
    {
      connection: redis,
      concurrency,
      lockDuration: 30_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  )

  const q = SHOW_REFRESH_QUEUE
  worker.on('completed', (job) =>
    logger.info({ q, jobId: job.id, showId: job.data.showId, ms: Date.now() - (job.processedOn ?? Date.now()) }, 'job completed'),
  )
  worker.on('failed', (job, err) =>
    logger.error({ q, jobId: job?.id, showId: job?.data.showId, attempts: job?.attemptsMade, err }, 'job failed'),
  )
  worker.on('stalled', (jobId) =>
    logger.warn({ q, jobId }, 'job stalled — lock expired, will retry'),
  )
  worker.on('error', (err) =>
    logger.error({ q, err }, 'worker error'),
  )

  return worker
}
