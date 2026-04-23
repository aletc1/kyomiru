import fp from 'fastify-plugin'
import { Redis } from 'ioredis'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

export const redisPlugin = fp(async (app) => {
  const redis = new Redis(app.config.REDIS_URL, { maxRetriesPerRequest: null })
  app.decorate('redis', redis)
  app.addHook('onClose', async () => { await redis.quit() })
})
