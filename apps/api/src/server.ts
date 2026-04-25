import './loadEnv.js'
import { Redis } from 'ioredis'
import { buildApp } from './app.js'
import { createEnrichmentWorker } from './workers/enrichmentWorker.js'
import { createShowRefreshWorker } from './workers/showRefreshWorker.js'
import { createShowMergeWorker } from './workers/showMergeWorker.js'

async function main() {
  const app = await buildApp()
  const { config } = app

  // Workers use a dedicated Redis connection — BullMQ workers hold blocking
  // commands (BRPOPLPUSH) that would serialise other Redis calls if shared.
  // maxRetriesPerRequest:null + enableReadyCheck:false are the BullMQ-recommended
  // settings for worker connections.
  const workerRedis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

  const enrichWorker = createEnrichmentWorker(
    app.db,
    workerRedis,
    config.TMDB_API_KEY,
    config.ENRICHMENT_LOCALES,
    app.showRefreshQueue,
    app.showMergeQueue,
    config.ENRICHMENT_CONCURRENCY,
  )
  const refreshWorker = createShowRefreshWorker(app.db, workerRedis, config.SHOW_REFRESH_CONCURRENCY)
  const mergeWorker = createShowMergeWorker(app.db, workerRedis, app.showRefreshQueue)

  await app.listen({ port: config.PORT, host: '0.0.0.0' })

  const shutdown = async () => {
    await enrichWorker.close()
    await refreshWorker.close()
    await mergeWorker.close()
    await workerRedis.quit()
    await app.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
