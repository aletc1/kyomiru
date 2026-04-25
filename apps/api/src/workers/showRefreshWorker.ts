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
      await existing.remove()
    }
  }
  await queue.add('refresh', { showId }, { jobId, removeOnComplete: true, removeOnFail: true })
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

export function createShowRefreshWorker(db: DbClient, redis: Redis) {
  return new Worker<ShowRefreshJobData>(
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
    { connection: redis, concurrency: 3 },
  )
}
