import type { FastifyInstance } from 'fastify'
import { syncRuns } from '@kyomiru/db/schema'
import { IngestBodySchema } from '@kyomiru/shared/contracts/ingest'
import type { HistoryItem, ShowTree } from '@kyomiru/providers/types'
import { ingestItems } from '../services/sync.service.js'

const INGEST_ENABLED_PROVIDERS = new Set(['crunchyroll'])

export async function providersRoutes(app: FastifyInstance) {
  app.post<{ Params: { provider: string }; Body: unknown }>(
    '/providers/:provider/ingest',
    { preHandler: app.requireExtensionAuth, bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
      const userId = req.extensionUserId!
      const providerKey = req.params.provider

      if (!INGEST_ENABLED_PROVIDERS.has(providerKey)) {
        return reply.status(404).send({ error: 'Provider does not support extension ingest' })
      }

      const body = IngestBodySchema.parse(req.body)

      const items: HistoryItem[] = body.items.map((i) => ({
        externalItemId: i.externalItemId,
        ...(i.externalShowId && { externalShowId: i.externalShowId }),
        ...(i.externalSeasonId && { externalSeasonId: i.externalSeasonId }),
        watchedAt: new Date(i.watchedAt),
        ...(i.playheadSeconds !== undefined && { playheadSeconds: i.playheadSeconds }),
        ...(i.durationSeconds !== undefined && { durationSeconds: i.durationSeconds }),
        ...(i.fullyWatched !== undefined && { fullyWatched: i.fullyWatched }),
        raw: i.raw ?? {},
      }))

      const showTrees: ShowTree[] = body.shows.map((s) => ({
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

      const [run] = await app.db.insert(syncRuns).values({
        userId,
        providerKey,
        trigger: 'manual',
        status: 'running',
      }).returning({ id: syncRuns.id })

      if (!run) return reply.status(500).send({ error: 'Failed to create sync run' })

      try {
        const counters = await ingestItems(app.db, userId, providerKey, items, showTrees, run.id, app.enrichmentQueue)
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
