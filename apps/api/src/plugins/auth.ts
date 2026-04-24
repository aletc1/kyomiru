import fp from 'fastify-plugin'
import * as client from 'openid-client'
import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { extensionTokens } from '@kyomiru/db/schema'
import type { FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireExtensionAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    oidcConfig: client.Configuration | null
  }
  interface FastifyRequest {
    extensionUserId?: string
    extensionTokenId?: string
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string
    sessionId: string
  }
}

export function hashExtensionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const authPlugin = fp(async (app) => {
  if (app.config.MOCK_GOOGLE_AUTH_USER) {
    app.log.warn({ mockUser: app.config.MOCK_GOOGLE_AUTH_USER }, 'MOCK_GOOGLE_AUTH_USER is set — Google OIDC is bypassed')
    app.decorate('oidcConfig', null)
  } else {
    const oidcConfig = await client.discovery(
      new URL('https://accounts.google.com'),
      app.config.GOOGLE_CLIENT_ID!,
      app.config.GOOGLE_CLIENT_SECRET!,
    )
    app.decorate('oidcConfig', oidcConfig)
  }

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.session.get('userId')
    if (!userId) {
      reply.status(401).send({ error: 'Unauthorized' })
    }
  }
  app.decorate('requireAuth', requireAuth)

  const requireExtensionAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing bearer token' })
    }
    const raw = header.slice('Bearer '.length).trim()
    if (!raw) return reply.status(401).send({ error: 'Missing bearer token' })

    const hash = hashExtensionToken(raw)
    const [row] = await app.db
      .select({ id: extensionTokens.id, userId: extensionTokens.userId })
      .from(extensionTokens)
      .where(and(eq(extensionTokens.tokenHash, hash), isNull(extensionTokens.revokedAt)))
      .limit(1)

    if (!row) return reply.status(401).send({ error: 'Invalid or revoked token' })

    req.extensionUserId = row.userId
    req.extensionTokenId = row.id
    await app.db
      .update(extensionTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(extensionTokens.id, row.id))
  }
  app.decorate('requireExtensionAuth', requireExtensionAuth)
})
