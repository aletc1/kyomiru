import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { userServices, providers } from '@kyomiru/db/schema'
import { ConnectServiceBodySchema } from '@kyomiru/shared/contracts/services'
import type { Provider } from '@kyomiru/providers/types'
import { encrypt } from '../crypto/secretbox.js'

const PROVIDER_INSTANCES: Record<string, Provider> = {}

export async function servicesRoutes(app: FastifyInstance) {
  app.get('/services', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const allProviders = await app.db.select().from(providers).where(eq(providers.enabled, true))
    const svcs = await app.db.select().from(userServices).where(eq(userServices.userId, userId))
    const map = new Map(svcs.map((s) => [s.providerKey, s]))

    const result = allProviders.map((p) => {
      const svc = map.get(p.key)
      return {
        providerKey: p.key,
        displayName: p.displayName,
        status: svc?.status ?? 'disconnected',
        lastSyncAt: svc?.lastSyncAt?.toISOString() ?? null,
        lastTestedAt: svc?.lastTestedAt?.toISOString() ?? null,
        lastError: svc?.lastError ?? null,
      }
    })
    reply.send(result)
  })

  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/services/:provider/test',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { provider: providerKey } = req.params
      const body = ConnectServiceBodySchema.parse(req.body)
      const p = PROVIDER_INSTANCES[providerKey]
      if (!p) return reply.status(404).send({ error: 'Unknown provider' })
      const result = await p.testConnection({ token: body.token })
      reply.send(result)
    },
  )

  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/services/:provider/connect',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { provider: providerKey } = req.params
      const body = ConnectServiceBodySchema.parse(req.body)
      const p = PROVIDER_INSTANCES[providerKey]
      if (!p) return reply.status(404).send({ error: 'Unknown provider' })

      const test = await p.testConnection({ token: body.token })
      if (!test.ok) return reply.status(400).send({ error: test.error ?? 'Connection failed' })

      const { ciphertext, nonce } = await encrypt(
        JSON.stringify({ token: body.token }),
        app.config.APP_SECRET_KEY,
      )

      await app.db.insert(userServices).values({
        userId,
        providerKey,
        status: 'connected',
        encryptedSecret: ciphertext,
        secretNonce: nonce,
        lastTestedAt: new Date(),
      }).onConflictDoUpdate({
        target: [userServices.userId, userServices.providerKey],
        set: {
          status: 'connected',
          encryptedSecret: ciphertext,
          secretNonce: nonce,
          lastTestedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        },
      })

      reply.send({ status: 'connected' })
    },
  )

  app.post<{ Params: { provider: string } }>(
    '/services/:provider/disconnect',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { provider: providerKey } = req.params
      await app.db.update(userServices)
        .set({ status: 'disconnected', encryptedSecret: null, secretNonce: null, updatedAt: new Date() })
        .where(and(eq(userServices.userId, userId), eq(userServices.providerKey, providerKey)))
      reply.send({ ok: true })
    },
  )
}
