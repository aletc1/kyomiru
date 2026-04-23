import './loadEnv.js'
import { buildApp } from './app.js'
import { createEnrichmentWorker } from './workers/enrichmentWorker.js'

async function main() {
  const app = await buildApp()
  const { config } = app

  const enrichWorker = createEnrichmentWorker(app.db, app.redis, config.TMDB_API_KEY)

  await app.listen({ port: config.PORT, host: '0.0.0.0' })

  const shutdown = async () => {
    await enrichWorker.close()
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
