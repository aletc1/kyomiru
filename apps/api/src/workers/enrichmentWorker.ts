import { Worker, Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import { eq, isNull } from 'drizzle-orm'
import { shows } from '@kyomiru/db/schema'
import { searchAniList, aniListTreeToSeasons } from '@kyomiru/providers/enrichment/anilist'
import { searchTMDb, fetchTMDbShowTree } from '@kyomiru/providers/enrichment/tmdb'
import type { SeasonTree } from '@kyomiru/providers/types'
import { upsertShowCatalog } from '../services/sync.service.js'
import { resolveExternalIds, withExternalIdRetry } from '../services/enrichmentMerge.js'
import { enqueueShowRefresh, type ShowRefreshJobData } from './showRefreshWorker.js'
import { classifyKind } from '../services/classifyKind.js'
import { logger } from '../util/logger.js'

export const ENRICHMENT_QUEUE = 'enrichment'

export interface EnrichmentJobData {
  showId: string
}

const ENRICHMENT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 1000 },
}

export function createEnrichmentQueue(redis: Redis) {
  return new Queue<EnrichmentJobData>(ENRICHMENT_QUEUE, { connection: redis })
}

/**
 * Enqueue an enrichment job, clearing any completed/failed ghost with the same
 * jobId first. BullMQ v5 silently no-ops `add()` when a job with the given
 * jobId already exists in Redis (including terminal states). The ghost removal
 * ensures shows that exhausted all retries get re-enqueued on the next cron run.
 */
export async function enqueueEnrichment(
  queue: Queue<EnrichmentJobData>,
  showId: string,
): Promise<void> {
  const jobId = `enrich-${showId}`
  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'completed' || state === 'failed') {
      await existing.remove().catch(() => {})
    }
  }
  await queue.add('enrich', { showId }, { jobId, ...ENRICHMENT_JOB_OPTIONS })
}

export async function enqueuePendingEnrichment(
  db: DbClient,
  queue: Queue<EnrichmentJobData>,
): Promise<number> {
  const rows = await db.select({ id: shows.id }).from(shows).where(isNull(shows.enrichedAt))
  for (const row of rows) {
    await enqueueEnrichment(queue, row.id)
  }
  return rows.length
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function createEnrichmentWorker(
  db: DbClient,
  redis: Redis,
  tmdbApiKey: string | undefined,
  locales: string[],
  showRefreshQueue: Queue<ShowRefreshJobData>,
  concurrency = 3,
) {
  const worker = new Worker<EnrichmentJobData>(
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
      const existingTitles = (show.titles as Record<string, string>) ?? {}
      const existingDescriptions = (show.descriptions as Record<string, string>) ?? {}
      let mergedTitles: Record<string, string> = { ...existingTitles }
      let mergedDescriptions: Record<string, string> = { ...existingDescriptions }

      // Step 1: Always try TMDB — it gives us classification signals (originalLanguage,
      // genres) and multi-locale show/episode titles regardless of kind.
      let tmdbMatch = null
      let tmdbTree = null
      if (tmdbApiKey) {
        const searchResult = await searchTMDb(show.canonicalTitle, tmdbApiKey, show.year ?? undefined)
        if (searchResult) {
          tmdbTree = await fetchTMDbShowTree(searchResult.id, tmdbApiKey, locales)
          // /search/tv only returns numeric genre_ids (so searchResult.genres
          // is always []), but classifyKind matches genre names. Carry the
          // resolved names from the detail fetch into tmdbMatch so the
          // classification rules see them.
          tmdbMatch = tmdbTree
            ? { ...searchResult, genres: tmdbTree.genres }
            : searchResult
          if (tmdbTree) {
            mergedTitles = { ...mergedTitles, ...tmdbTree.titles }
            mergedDescriptions = { ...mergedDescriptions, ...tmdbTree.descriptions }
            seasonTrees = tmdbTree.seasons
          }
        }
      }

      // Step 2: Classify kind using TMDB signals. This may promote a Netflix
      // show from 'tv' to 'anime' if the TMDB data says Japanese animation.
      const classifiedKind = classifyKind(show.kind as 'anime' | 'tv' | 'movie', { tmdb: tmdbMatch })

      // Step 3: If the show is (or was reclassified to) anime, try AniList.
      // AniList titles win for anime and give the definitive episode count.
      let anilistMatch = null
      if (classifiedKind === 'anime' || show.kind === 'anime') {
        anilistMatch = await searchAniList(show.canonicalTitle, show.year ?? undefined)
        if (anilistMatch) {
          // AniList titles merged on top of TMDB titles — AniList is authoritative for anime.
          mergedTitles = { ...mergedTitles, ...anilistMatch.titles }
          // If AniList has a better episode structure than TMDB, prefer it.
          const anilistSeasons = aniListTreeToSeasons(anilistMatch)
          if (anilistSeasons.length > 0 && seasonTrees.length === 0) {
            seasonTrees = anilistSeasons
          }
        }
      }

      // Step 4: Re-classify with both signals (AniList match may raise confidence).
      const finalKind = classifyKind(
        classifiedKind,
        { tmdb: tmdbMatch, anilist: anilistMatch },
      )

      // Ensure 'en' key is always populated from canonical title if not set.
      if (!mergedTitles['en'] && show.canonicalTitle) mergedTitles['en'] = show.canonicalTitle
      if (!mergedDescriptions['en'] && show.description) mergedDescriptions['en'] = show.description

      // Derive the canonical title (English-first, fallback to existing).
      const newCanonicalTitle =
        (anilistMatch?.canonicalTitle) ??
        mergedTitles['en'] ??
        tmdbMatch?.title ??
        show.canonicalTitle

      const newDescription =
        mergedDescriptions['en'] ??
        anilistMatch?.description ??
        tmdbMatch?.description ??
        show.description ??
        null

      if (tmdbMatch || anilistMatch) {
        matched = true

        const genres =
          show.genres.length > 0
            ? show.genres
            : (tmdbTree?.genres.length ? tmdbTree.genres : (anilistMatch?.genres ?? []))
        const rating =
          anilistMatch?.rating !== undefined
            ? anilistMatch.rating
            : (tmdbTree?.rating ?? tmdbMatch?.rating ?? null)
        const coverUrl = show.coverUrl ?? anilistMatch?.coverUrl ?? tmdbMatch?.coverUrl ?? null
        const year = show.year ?? anilistMatch?.year ?? tmdbMatch?.year ?? null
        const current = { tmdbId: show.tmdbId, anilistId: show.anilistId }
        const proposed = {
          tmdbId: show.tmdbId ?? tmdbMatch?.id ?? null,
          anilistId: show.anilistId ?? anilistMatch?.id ?? null,
        }
        const resolved = await resolveExternalIds(db, showId, current, proposed)
        for (const c of resolved.conflicts) {
          logger.warn(
            { showId, conflictingShowId: c.conflictingShowId, kind: c.kind, externalId: c.externalId },
            'enrichment external id conflict — duplicate show rows',
          )
        }

        await withExternalIdRetry(
          current,
          { tmdbId: resolved.tmdbId, anilistId: resolved.anilistId },
          ({ tmdbId, anilistId }) => db.update(shows).set({
            canonicalTitle: newCanonicalTitle,
            titleNormalized: newCanonicalTitle.toLowerCase().replace(/[^\w\s]/g, ''),
            description: newDescription,
            coverUrl,
            genres,
            year,
            kind: finalKind,
            titles: mergedTitles,
            descriptions: mergedDescriptions,
            tmdbId,
            anilistId,
            rating: rating !== null && rating !== undefined ? rating.toFixed(1) : show.rating,
            enrichedAt: new Date(),
            enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1,
          }).where(eq(shows.id, showId)),
          ({ kind, attempt }) => logger.warn(
            { showId, kind, attempt },
            'enrichment shows.{tmdb,anilist}_id race — retrying with current value',
          ),
        )
      } else {
        await db.update(shows)
          .set({ enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1 })
          .where(eq(shows.id, showId))
      }

      if (matched && seasonTrees.length > 0) {
        await upsertShowCatalog(db, showId, null, seasonTrees)
        await enqueueShowRefresh(showRefreshQueue, showId)
      }

      logger.info(
        { showId, matched, kind: finalKind, seasons: seasonTrees.length },
        matched ? `enriched ${showId}` : `no match for ${showId}`,
      )
    },
    {
      connection: redis,
      concurrency,
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  )

  const q = ENRICHMENT_QUEUE
  worker.on('completed', (job) =>
    logger.info({ q, jobId: job.id, showId: job.data.showId, ms: Date.now() - (job.processedOn ?? Date.now()) }, 'job completed'),
  )
  worker.on('failed', (job, err) =>
    logger.error({ q, jobId: job?.id, showId: job?.data.showId, attempts: job?.attemptsMade, err }, 'job failed'),
  )
  worker.on('stalled', (jobId) =>
    logger.warn({ q, jobId }, 'job stalled — lock expired, will retry'),
  )
  worker.on('error', (err) =>
    logger.error({ q, err }, 'worker error'),
  )

  return worker
}
