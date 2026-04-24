import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'

export async function healthzRoutes(app: FastifyInstance) {
  app.get('/healthz', { config: { rateLimit: false } }, async (_req, reply) => {
    let db = false
    let redis = false
    try {
      await app.db.execute(sql`SELECT 1`)
      db = true
    } catch {}
    try {
      await app.redis.ping()
      redis = true
    } catch {}
    const ok = db && redis
    reply.code(ok ? 200 : 503).send({ ok, db, redis })
  })
}
