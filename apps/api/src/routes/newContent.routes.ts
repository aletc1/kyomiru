import type { FastifyInstance } from 'fastify'
import { eq, and, count } from 'drizzle-orm'
import { userShowState } from '@kyomiru/db/schema'

export async function newContentRoutes(app: FastifyInstance) {
  app.get('/new-content-count', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const [row] = await app.db
      .select({ count: count() })
      .from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.status, 'new_content')))
    reply.send({ count: row?.count ?? 0 })
  })

  app.get('/coming-soon-count', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const [row] = await app.db
      .select({ count: count() })
      .from(userShowState)
      .where(and(eq(userShowState.userId, userId), eq(userShowState.status, 'coming_soon')))
    reply.send({ count: row?.count ?? 0 })
  })
}
