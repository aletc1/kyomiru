import fp from 'fastify-plugin'
import type { Queue } from 'bullmq'
import { createShowRefreshQueue, type ShowRefreshJobData } from '../workers/showRefreshWorker.js'

declare module 'fastify' {
  interface FastifyInstance {
    showRefreshQueue: Queue<ShowRefreshJobData>
  }
}

export const showRefreshQueuePlugin = fp(async (app) => {
  const queue = createShowRefreshQueue(app.redis)
  app.decorate('showRefreshQueue', queue)
  app.addHook('onClose', async () => { await queue.close() })
})
