import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import { eq, isNull, sql } from 'drizzle-orm'
import { shows, episodes } from '@kyomiru/db/schema'
import { searchAniList, aniListTreeToSeasons } from '@kyomiru/providers/enrichment/anilist'
import { searchTMDb, fetchTMDbShowTree } from '@kyomiru/providers/enrichment/tmdb'
import type { SeasonTree } from '@kyomiru/providers/types'
import { upsertShowCatalog } from '../services/sync.service.js'
import { logger } from '../util/logger.js'

export const ENRICHMENT_QUEUE = 'enrichment'

export interface EnrichmentJobData {
  showId: string
}

export function createEnrichmentQueue(redis: Redis) {
  return new Queue<EnrichmentJobData>(ENRICHMENT_QUEUE, { connection: redis })
}

export async function enqueuePendingEnrichment(
  db: DbClient,
  queue: Queue<EnrichmentJobData>,
): Promise<number> {
  const rows = await db.select({ id: shows.id }).from(shows).where(isNull(shows.enrichedAt))
  for (const row of rows) {
    await queue.add(
      'enrich',
      { showId: row.id },
      { jobId: `enrich-${row.id}`, removeOnComplete: 100, removeOnFail: 500 },
    )
  }
  return rows.length
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

async function refreshLatestAirDate(db: DbClient, showId: string): Promise<void> {
  const [row] = await db
    .select({ latest: sql<string | null>`MAX(${episodes.airDate})` })
    .from(episodes)
    .where(eq(episodes.showId, showId))
  if (row?.latest) {
    await db.update(shows).set({ latestAirDate: row.latest }).where(eq(shows.id, showId))
  }
}

export function createEnrichmentWorker(db: DbClient, redis: Redis, tmdbApiKey: string | undefined) {
  return new Worker<EnrichmentJobData>(
    ENRICHMENT_QUEUE,
    async (job) => {
      const { showId } = job.data
      logger.info({ showId }, `enriching ${showId}`)

      const [show] = await db.select().from(shows).where(eq(shows.id, showId))
      if (!show) return

      // Freshness short-circuit
      if (show.enrichedAt && Date.now() - show.enrichedAt.getTime() < SEVEN_DAYS_MS) {
        logger.debug({ showId }, `enrichment skipped (fresh): ${showId}`)
        return
      }

      let matched = false
      let seasonTrees: SeasonTree[] = []

      if (show.kind === 'anime') {
        const result = await searchAniList(show.canonicalTitle, show.year ?? undefined)
        if (result) {
          seasonTrees = aniListTreeToSeasons(result)
          await db.update(shows).set({
            description: show.description ?? result.description ?? null,
            coverUrl: show.coverUrl ?? result.coverUrl ?? null,
            genres: show.genres.length > 0 ? show.genres : result.genres,
            year: show.year ?? result.year ?? null,
            anilistId: show.anilistId ?? result.id,
            rating: result.rating !== undefined ? result.rating.toFixed(1) : show.rating,
            enrichedAt: new Date(),
            enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1,
          }).where(eq(shows.id, showId))
          matched = true
        }
      }

      if (!matched && tmdbApiKey) {
        const result = await searchTMDb(show.canonicalTitle, tmdbApiKey, show.year ?? undefined)
        if (result) {
          const tree = await fetchTMDbShowTree(result.id, tmdbApiKey)
          const genres = tree?.genres.length ? tree.genres : result.genres
          const rating = tree?.rating ?? result.rating
          seasonTrees = tree?.seasons ?? []
          await db.update(shows).set({
            description: show.description ?? result.description ?? null,
            coverUrl: show.coverUrl ?? result.coverUrl ?? null,
            genres: show.genres.length > 0 ? show.genres : genres,
            year: show.year ?? result.year ?? null,
            tmdbId: show.tmdbId ?? result.id,
            rating: rating !== undefined ? rating.toFixed(1) : show.rating,
            enrichedAt: new Date(),
            enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1,
          }).where(eq(shows.id, showId))
          matched = true
        }
      }

      if (!matched) {
        await db.update(shows)
          .set({ enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1 })
          .where(eq(shows.id, showId))
      } else if (seasonTrees.length > 0) {
        // providerKey=null: enrichment-sourced episodes have no streaming-provider
        // external id. Existing episodes are preserved by ON CONFLICT DO NOTHING.
        await upsertShowCatalog(db, showId, null, seasonTrees)
        await refreshLatestAirDate(db, showId)
      }

      logger.info({ showId, matched, seasons: seasonTrees.length }, matched ? `enriched ${showId}` : `no match for ${showId}`)
    },
    { connection: redis, concurrency: 3 },
  )
}
