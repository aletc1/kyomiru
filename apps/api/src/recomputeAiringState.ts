import './loadEnv.js'
import { count, ne } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { createDbClient } from '@kyomiru/db/client'
import { episodes, userShowState } from '@kyomiru/db/schema'
import { validateEnv } from './plugins/env.js'
import { airedEpisodesFilter } from './services/stateMachine.js'
import { createShowRefreshQueue, enqueueShowRefresh } from './workers/showRefreshWorker.js'
import { logger } from './util/logger.js'

async function main() {
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = createShowRefreshQueue(redis)

  // Drift detection: aired count per show, vs each user's stored total.
  // Two pulls + a JS join keeps this in Drizzle's typed query builder rather
  // than reaching for a correlated subquery.
  const [ussRows, airedRows] = await Promise.all([
    db
      .select({ showId: userShowState.showId, totalEpisodes: userShowState.totalEpisodes })
      .from(userShowState)
      .where(ne(userShowState.status, 'removed')),
    db
      .select({ showId: episodes.showId, aired: count() })
      .from(episodes)
      .where(airedEpisodesFilter())
      .groupBy(episodes.showId),
  ])

  const airedByShow = new Map(airedRows.map((r) => [r.showId, r.aired]))
  const driftedShows = new Set<string>()
  for (const r of ussRows) {
    const aired = airedByShow.get(r.showId) ?? 0
    if (r.totalEpisodes !== aired) driftedShows.add(r.showId)
  }

  logger.info(`Enqueueing show-refresh for ${driftedShows.size} drifted show(s)`)

  for (const showId of driftedShows) {
    await enqueueShowRefresh(queue, showId)
  }

  logger.info('Done')
  await queue.close()
  await redis.quit()
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
