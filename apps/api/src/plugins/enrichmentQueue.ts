import fp from 'fastify-plugin'
import type { Queue } from 'bullmq'
import { createEnrichmentQueue, type EnrichmentJobData } from '../workers/enrichmentWorker.js'

declare module 'fastify' {
  interface FastifyInstance {
    enrichmentQueue: Queue<EnrichmentJobData>
  }
}

export const enrichmentQueuePlugin = fp(async (app) => {
  const queue = createEnrichmentQueue(app.redis)
  app.decorate('enrichmentQueue', queue)
  app.addHook('onClose', async () => { await queue.close() })
})
