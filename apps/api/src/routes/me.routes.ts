import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { users } from '@kyomiru/db/schema'

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const [user] = await app.db.select().from(users).where(eq(users.id, userId))
    if (!user) return reply.status(404).send({ error: 'User not found' })
    reply.send({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    })
  })
}
