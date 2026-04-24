import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { eq, and, isNull, desc, count, max, inArray } from 'drizzle-orm'
import { extensionTokens, users, syncRuns } from '@kyomiru/db/schema'
import { CreateExtensionTokenBodySchema } from '@kyomiru/shared/contracts/ingest'
import { hashExtensionToken } from '../plugins/auth.js'

const MAX_ACTIVE_TOKENS_PER_USER = 5
const TOKEN_PREFIX = 'kym_ext_'

function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

export async function extensionRoutes(app: FastifyInstance) {
  app.get('/extension/me', { preHandler: app.requireExtensionAuth }, async (req, reply) => {
    const userId = req.extensionUserId!
    const [u] = await app.db
      .select({ id: users.id, email: users.email, displayName: users.displayName, preferredLocale: users.preferredLocale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!u) return reply.status(404).send({ error: 'User not found' })
    reply.send({ id: u.id, email: u.email, displayName: u.displayName, preferredLocale: u.preferredLocale ?? null })
  })

  app.get('/extension/tokens', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const rows = await app.db
      .select({
        id: extensionTokens.id,
        label: extensionTokens.label,
        createdAt: extensionTokens.createdAt,
        lastUsedAt: extensionTokens.lastUsedAt,
      })
      .from(extensionTokens)
      .where(and(eq(extensionTokens.userId, userId), isNull(extensionTokens.revokedAt)))
      .orderBy(desc(extensionTokens.createdAt))

    const tokenIds = rows.map((r) => r.id)
    const syncsByToken = new Map<string, Record<string, string>>()

    if (tokenIds.length > 0) {
      const syncs = await app.db
        .select({
          extensionTokenId: syncRuns.extensionTokenId,
          providerKey: syncRuns.providerKey,
          lastSyncAt: max(syncRuns.finishedAt),
        })
        .from(syncRuns)
        .where(and(
          inArray(syncRuns.extensionTokenId, tokenIds),
          eq(syncRuns.status, 'success'),
        ))
        .groupBy(syncRuns.extensionTokenId, syncRuns.providerKey)

      for (const s of syncs) {
        if (!s.extensionTokenId || !s.lastSyncAt) continue
        const map = syncsByToken.get(s.extensionTokenId) ?? {}
        map[s.providerKey] = s.lastSyncAt.toISOString()
        syncsByToken.set(s.extensionTokenId, map)
      }
    }

    reply.send(rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      syncsByProvider: syncsByToken.get(r.id) ?? {},
    })))
  })

  app.post<{ Body: unknown }>(
    '/extension/tokens',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const body = CreateExtensionTokenBodySchema.parse(req.body)

      const [activeCount] = await app.db
        .select({ c: count() })
        .from(extensionTokens)
        .where(and(eq(extensionTokens.userId, userId), isNull(extensionTokens.revokedAt)))

      if ((activeCount?.c ?? 0) >= MAX_ACTIVE_TOKENS_PER_USER) {
        return reply.status(400).send({
          error: `Maximum of ${MAX_ACTIVE_TOKENS_PER_USER} active tokens reached. Revoke an existing one first.`,
        })
      }

      const token = generateRawToken()
      const tokenHash = hashExtensionToken(token)

      const [row] = await app.db.insert(extensionTokens).values({
        userId,
        label: body.label,
        tokenHash,
      }).returning({
        id: extensionTokens.id,
        label: extensionTokens.label,
        createdAt: extensionTokens.createdAt,
        lastUsedAt: extensionTokens.lastUsedAt,
      })

      if (!row) return reply.status(500).send({ error: 'Failed to create token' })

      reply.send({
        id: row.id,
        label: row.label,
        token,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/extension/tokens/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { id } = req.params

      const result = await app.db
        .update(extensionTokens)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(extensionTokens.id, id),
          eq(extensionTokens.userId, userId),
          isNull(extensionTokens.revokedAt),
        ))
        .returning({ id: extensionTokens.id })

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Token not found' })
      }

      reply.send({ ok: true })
    },
  )
}
