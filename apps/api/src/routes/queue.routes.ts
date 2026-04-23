import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { userShowState } from '@kyomiru/db/schema'
import { QueueReorderBodySchema } from '@kyomiru/shared/contracts/auth'

export async function queueRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>(
    '/queue/reorder',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { showIds } = QueueReorderBodySchema.parse(req.body)

      await app.db.transaction(async (tx) => {
        for (let i = 0; i < showIds.length; i++) {
          await tx
            .update(userShowState)
            .set({ queuePosition: i + 1, updatedAt: new Date() })
            .where(
              and(
                eq(userShowState.userId, userId),
                eq(userShowState.showId, showIds[i]!),
              ),
            )
        }
      })

      reply.send({ ok: true })
    },
  )
}
