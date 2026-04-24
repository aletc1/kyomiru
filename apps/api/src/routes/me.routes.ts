import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '@kyomiru/db/schema'

const PatchMeBodySchema = z.object({
  preferredLocale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Expected a BCP-47 locale like "en" or "en-US"')
    .nullable(),
}).strict()

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
      preferredLocale: user.preferredLocale ?? null,
    })
  })

  app.patch<{ Body: unknown }>(
    '/me',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const body = PatchMeBodySchema.parse(req.body)

      await app.db
        .update(users)
        .set({ preferredLocale: body.preferredLocale, updatedAt: new Date() })
        .where(eq(users.id, userId))

      reply.send({ ok: true })
    },
  )
}
