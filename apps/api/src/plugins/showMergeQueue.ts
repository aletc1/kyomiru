import fp from 'fastify-plugin'
import type { Queue } from 'bullmq'
import { createShowMergeQueue, type ShowMergeJobData } from '../workers/showMergeWorker.js'

declare module 'fastify' {
  interface FastifyInstance {
    showMergeQueue: Queue<ShowMergeJobData>
  }
}

export const showMergeQueuePlugin = fp(async (app) => {
  const queue = createShowMergeQueue(app.redis)
  app.decorate('showMergeQueue', queue)
  app.addHook('onClose', async () => { await queue.close() })
})
