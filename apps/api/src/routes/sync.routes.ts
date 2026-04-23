import type { FastifyInstance } from 'fastify'
import { eq, and, desc } from 'drizzle-orm'
import { userServices, syncRuns } from '@kyomiru/db/schema'
import { Queue } from 'bullmq'
import type { SyncJobData } from '../workers/syncWorker.js'
import { SYNC_QUEUE } from '../workers/syncWorker.js'

export async function syncRoutes(app: FastifyInstance) {
  app.post<{ Body: { provider?: string } }>(
    '/sync',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { provider } = req.body ?? {}

      // Check cooldown
      const [recent] = await app.db
        .select()
        .from(syncRuns)
        .where(and(
          eq(syncRuns.userId, userId),
          eq(syncRuns.status, 'running'),
        ))
        .orderBy(desc(syncRuns.startedAt))
        .limit(1)

      if (recent) {
        const age = Date.now() - recent.startedAt.getTime()
        if (age < 5 * 60 * 1000) {
          return reply.status(429).send({ error: 'Sync already running, please wait' })
        }
      }

      const queue = new Queue<SyncJobData>(SYNC_QUEUE, { connection: app.redis })

      const svcs = await app.db
        .select()
        .from(userServices)
        .where(and(
          eq(userServices.userId, userId),
          eq(userServices.status, 'connected'),
          ...(provider ? [eq(userServices.providerKey, provider)] : []),
        ))

      if (svcs.length === 0) {
        return reply.status(400).send({ error: 'No connected services' })
      }

      const runIds: string[] = []
      for (const svc of svcs) {
        const job = await queue.add(
          'sync',
          { userId, providerKey: svc.providerKey, trigger: 'manual' },
          { jobId: `manual-${userId}-${svc.providerKey}-${Date.now()}` },
        )
        runIds.push(job.id ?? '')
      }

      await queue.close()
      reply.send({ runIds })
    },
  )

  app.get('/sync/latest', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const runs = await app.db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.userId, userId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(10)

    reply.send(runs.map((r) => ({
      id: r.id,
      providerKey: r.providerKey,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      itemsIngested: r.itemsIngested,
      itemsNew: r.itemsNew,
      errors: r.errors,
    })))
  })
}
