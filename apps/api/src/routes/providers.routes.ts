import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { syncRuns } from '@kyomiru/db/schema'
import {
  IngestBodySchema,
  IngestChunkBodySchema,
  IngestFinalizeBodySchema,
  IngestStartBodySchema,
  IngestResolveBodySchema,
  type IngestBody,
  type IngestChunkBody,
} from '@kyomiru/shared/contracts/ingest'
import type { HistoryItem, ShowTree } from '@kyomiru/providers/types'
import {
  finalizeIngestRun,
  ingestChunk,
  ingestItems,
  markUserServiceConnected,
  resolveShowCatalogStatus,
} from '../services/sync.service.js'

const INGEST_ENABLED_PROVIDERS = new Set(['crunchyroll'])

function mapItems(body: IngestBody): HistoryItem[] {
  return body.items.map((i) => ({
    externalItemId: i.externalItemId,
    ...(i.externalShowId && { externalShowId: i.externalShowId }),
    ...(i.externalSeasonId && { externalSeasonId: i.externalSeasonId }),
    watchedAt: new Date(i.watchedAt),
    ...(i.playheadSeconds !== undefined && { playheadSeconds: i.playheadSeconds }),
    ...(i.durationSeconds !== undefined && { durationSeconds: i.durationSeconds }),
    ...(i.fullyWatched !== undefined && { fullyWatched: i.fullyWatched }),
    raw: i.raw ?? {},
  }))
}

function mapShows(body: IngestBody): ShowTree[] {
  return body.shows.map((s) => ({
    externalId: s.externalId,
    title: s.title,
    ...(s.description && { description: s.description }),
    ...(s.coverUrl && { coverUrl: s.coverUrl }),
    ...(s.year !== undefined && { year: s.year }),
    ...(s.kind && { kind: s.kind }),
    seasons: s.seasons.map((se) => ({
      number: se.number,
      ...(se.title && { title: se.title }),
      ...(se.airDate && { airDate: se.airDate }),
      episodes: se.episodes.map((e) => ({
        number: e.number,
        ...(e.title && { title: e.title }),
        ...(e.durationSeconds !== undefined && { durationSeconds: e.durationSeconds }),
        ...(e.airDate && { airDate: e.airDate }),
        externalId: e.externalId,
      })),
    })),
  }))
}

async function findRun(app: FastifyInstance, runId: string, userId: string, providerKey: string) {
  const [row] = await app.db
    .select({ id: syncRuns.id, status: syncRuns.status })
    .from(syncRuns)
    .where(and(
      eq(syncRuns.id, runId),
      eq(syncRuns.userId, userId),
      eq(syncRuns.providerKey, providerKey),
    ))
    .limit(1)
  return row ?? null
}

async function findActiveRun(app: FastifyInstance, userId: string, providerKey: string) {
  const [row] = await app.db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(
      eq(syncRuns.userId, userId),
      eq(syncRuns.providerKey, providerKey),
      eq(syncRuns.status, 'running'),
    ))
    .limit(1)
  return row ?? null
}

function guardProvider(reply: FastifyReply, providerKey: string): boolean {
  if (!INGEST_ENABLED_PROVIDERS.has(providerKey)) {
    reply.status(404).send({ error: 'Provider does not support extension ingest' })
    return false
  }
  return true
}

export async function providersRoutes(app: FastifyInstance) {
  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/providers/:provider/ingest/resolve',
    { preHandler: app.requireExtensionAuth },
    async (req: FastifyRequest<{ Params: { provider: string }; Body: unknown }>, reply) => {
      const providerKey = req.params.provider
      if (!guardProvider(reply, providerKey)) return

      const body = IngestResolveBodySchema.parse(req.body)
      const results = await resolveShowCatalogStatus(app.db, providerKey, body.externalShowIds)
      reply.send({
        shows: results.map((r) => ({
          externalShowId: r.externalShowId,
          known: r.known,
          catalogSyncedAt: r.catalogSyncedAt?.toISOString() ?? null,
          seasonCoverage: r.seasonCoverage,
        })),
      })
    },
  )

  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/providers/:provider/ingest/start',
    { preHandler: app.requireExtensionAuth },
    async (req: FastifyRequest<{ Params: { provider: string }; Body: unknown }>, reply) => {
      const userId = req.extensionUserId!
      const providerKey = req.params.provider
      if (!guardProvider(reply, providerKey)) return

      const body = IngestStartBodySchema.parse(req.body ?? {})
      const trigger = body.trigger ?? 'manual'

      if (body.resumeRunId) {
        const run = await findRun(app, body.resumeRunId, userId, providerKey)
        if (!run || run.status !== 'running') {
          return reply.status(404).send({ error: 'Run not found or not resumable' })
        }
        return reply.send({ runId: run.id, resumed: true })
      }

      const existing = await findActiveRun(app, userId, providerKey)
      if (existing) {
        return reply.status(409).send({ error: 'run_in_progress', runId: existing.id })
      }

      // Ensure the userServices row exists so even an empty sync (start →
      // finalize with zero chunks) marks the user as connected.
      await markUserServiceConnected(app.db, userId, providerKey)

      let run: { id: string } | undefined
      try {
        const [inserted] = await app.db.insert(syncRuns).values({
          userId,
          providerKey,
          trigger,
          status: 'running',
        }).returning({ id: syncRuns.id })
        run = inserted
      } catch (err: unknown) {
        // Partial unique index sync_runs_one_running_per_user_provider fires
        // when two requests race past the findActiveRun check above.
        if ((err as { code?: string }).code === '23505') {
          const conflict = await findActiveRun(app, userId, providerKey)
          if (conflict) return reply.status(409).send({ error: 'run_in_progress', runId: conflict.id })
        }
        throw err
      }

      if (!run) return reply.status(500).send({ error: 'Failed to create sync run' })
      reply.send({ runId: run.id, resumed: false })
    },
  )

  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/providers/:provider/ingest/chunk',
    { preHandler: app.requireExtensionAuth, bodyLimit: 2 * 1024 * 1024 },
    async (req: FastifyRequest<{ Params: { provider: string }; Body: unknown }>, reply) => {
      const userId = req.extensionUserId!
      const providerKey = req.params.provider
      if (!guardProvider(reply, providerKey)) return

      const body: IngestChunkBody = IngestChunkBodySchema.parse(req.body)
      const run = await findRun(app, body.runId, userId, providerKey)
      if (!run) return reply.status(404).send({ error: 'Run not found' })
      if (run.status !== 'running') {
        return reply.status(409).send({ error: 'Run is not running', status: run.status })
      }

      const items = mapItems(body)
      const showTrees = mapShows(body)

      try {
        const counters = await ingestChunk(
          app.db,
          userId,
          providerKey,
          items,
          showTrees,
          run.id,
          app.enrichmentQueue,
          app.redis,
        )
        reply.send({
          runId: run.id,
          itemsReceived: items.length,
          itemsIngested: counters.itemsIngested,
          itemsSkipped: counters.itemsSkipped,
          itemsNew: counters.itemsNew,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reply.status(500).send({ error: message, runId: run.id })
      }
    },
  )

  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/providers/:provider/ingest/finalize',
    { preHandler: app.requireExtensionAuth },
    async (req: FastifyRequest<{ Params: { provider: string }; Body: unknown }>, reply) => {
      const userId = req.extensionUserId!
      const providerKey = req.params.provider
      if (!guardProvider(reply, providerKey)) return

      const body = IngestFinalizeBodySchema.parse(req.body)
      const run = await findRun(app, body.runId, userId, providerKey)
      if (!run) return reply.status(404).send({ error: 'Run not found' })
      if (run.status !== 'running') {
        return reply.status(409).send({ error: 'Run is not running', status: run.status })
      }

      try {
        const counters = await finalizeIngestRun(app.db, userId, providerKey, run.id, app.redis)
        reply.send({
          runId: run.id,
          itemsIngested: counters.itemsIngested,
          itemsNew: counters.itemsNew,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reply.status(500).send({ error: message, runId: run.id })
      }
    },
  )

  // Back-compat single-shot path: start → chunk → finalize in one call.
  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/providers/:provider/ingest',
    { preHandler: app.requireExtensionAuth, bodyLimit: 2 * 1024 * 1024 },
    async (req: FastifyRequest<{ Params: { provider: string }; Body: unknown }>, reply) => {
      const userId = req.extensionUserId!
      const providerKey = req.params.provider
      if (!guardProvider(reply, providerKey)) return

      const existing = await findActiveRun(app, userId, providerKey)
      if (existing) {
        return reply.status(409).send({ error: 'run_in_progress', runId: existing.id })
      }

      const body = IngestBodySchema.parse(req.body)
      const items = mapItems(body)
      const showTrees = mapShows(body)

      const [run] = await app.db.insert(syncRuns).values({
        userId,
        providerKey,
        trigger: 'manual',
        status: 'running',
      }).returning({ id: syncRuns.id })

      if (!run) return reply.status(500).send({ error: 'Failed to create sync run' })

      try {
        const counters = await ingestItems(
          app.db,
          userId,
          providerKey,
          items,
          showTrees,
          run.id,
          app.enrichmentQueue,
          app.redis,
        )
        reply.send({
          runId: run.id,
          itemsIngested: counters.itemsIngested,
          itemsNew: counters.itemsNew,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reply.status(500).send({ error: message, runId: run.id })
      }
    },
  )
}
