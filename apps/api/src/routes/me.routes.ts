import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '@kyomiru/db/schema'
import { SUPPORTED_UI_LOCALES } from '@kyomiru/shared'

const ALLOWED_LOCALES = [...SUPPORTED_UI_LOCALES, 'ja-JP'] as const

const PatchMeBodySchema = z.object({
  preferredLocale: z.enum(ALLOWED_LOCALES).nullable(),
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
