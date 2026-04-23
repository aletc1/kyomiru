import { eq, and, sql, inArray } from 'drizzle-orm'
import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { DbClient } from '@kyomiru/db/client'
import {
  userServices, watchEvents, episodeProviders, episodes,
  shows, showProviders, seasons, userEpisodeProgress,
  userShowState, syncRuns,
} from '@kyomiru/db/schema'
import type { HistoryItem, SeasonTree, ShowTree } from '@kyomiru/providers/types'
import { recomputeUserShowState } from './stateMachine.js'
import { enqueueEnrichment, type EnrichmentJobData } from '../workers/enrichmentWorker.js'
import { logger } from '../util/logger.js'

const RUN_KEY_TTL_SECONDS = 3600

function runKey(providerKey: string, runId: string, suffix: string): string {
  return `kyomiru:sync:${providerKey}:${runId}:${suffix}`
}

const WATCHED_THRESHOLD = 0.9

/**
 * Upsert a show's full season/episode tree.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING on the natural keys
 * (seasons_show_number_idx, episodes_season_number_idx,
 * episode_providers_external_idx) so re-ingesting the same catalog is a no-op.
 * seasons.episode_count is updated on conflict so the largest known count wins.
 *
 * Pass providerKey=null for enrichment-sourced trees (TMDb/AniList), where
 * episodes don't map to a streaming provider's external id.
 */
export async function upsertShowCatalog(
  db: DbClient,
  showId: string,
  providerKey: string | null,
  seasonTrees: SeasonTree[],
): Promise<void> {
  if (providerKey) {
    await db.update(showProviders)
      .set({ catalogSyncedAt: new Date() })
      .where(and(eq(showProviders.showId, showId), eq(showProviders.providerKey, providerKey)))
  }

  for (const s of seasonTrees) {
    const [season] = await db.insert(seasons).values({
      showId,
      seasonNumber: s.number,
      title: s.title ?? null,
      airDate: s.airDate ?? null,
      episodeCount: s.episodes.length,
    }).onConflictDoUpdate({
      target: [seasons.showId, seasons.seasonNumber],
      set: {
        episodeCount: sql`GREATEST(${seasons.episodeCount}, EXCLUDED.episode_count)`,
      },
    }).returning({ id: seasons.id })

    const seasonId = season?.id ?? (await db.select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, s.number)))
      .then((r) => r[0]?.id))

    if (!seasonId) continue

    for (const e of s.episodes) {
      const [ep] = await db.insert(episodes).values({
        seasonId,
        showId,
        episodeNumber: e.number,
        title: e.title ?? null,
        durationSeconds: e.durationSeconds ?? null,
        airDate: e.airDate ?? null,
      }).onConflictDoNothing().returning({ id: episodes.id })

      const epId = ep?.id ?? (await db.select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.seasonId, seasonId), eq(episodes.episodeNumber, e.number)))
        .then((r) => r[0]?.id))

      if (!epId) continue

      if (providerKey && e.externalId) {
        await db.insert(episodeProviders).values({
          episodeId: epId,
          providerKey,
          externalId: e.externalId,
        }).onConflictDoNothing()
      }
    }
  }
}

export function isWatched(playhead: number | undefined, duration: number | undefined, fullyWatched: boolean | undefined): boolean {
  if (fullyWatched) return true
  if (playhead !== undefined && duration !== undefined && duration > 0) {
    return playhead / duration >= WATCHED_THRESHOLD
  }
  return false
}

export type ShowResolver = (externalShowId: string) => Promise<ShowTree | null>

interface IngestCounters {
  itemsIngested: number
  itemsNew: number
  itemsSkipped: number
}

async function processHistoryItem(
  db: DbClient,
  userId: string,
  providerKey: string,
  item: HistoryItem,
  resolveShow: ShowResolver,
  touchedShowIds: Set<string>,
  counters: IngestCounters,
  enrichmentQueue: Queue<EnrichmentJobData> | null,
): Promise<void> {
  // Upsert raw watch event
  await db.insert(watchEvents).values({
    userId,
    providerKey,
    externalItemId: item.externalItemId,
    watchedAt: item.watchedAt,
    playheadSeconds: item.playheadSeconds ?? null,
    durationSeconds: item.durationSeconds ?? null,
    fullyWatched: item.fullyWatched ?? false,
    raw: (item.raw ?? {}) as Record<string, unknown>,
  }).onConflictDoNothing()

  const episodeId = await resolveEpisode(db, item, providerKey, resolveShow, enrichmentQueue)
  if (!episodeId) {
    counters.itemsSkipped++
    logger.debug(
      { externalItemId: item.externalItemId, externalShowId: item.externalShowId },
      'Episode not resolved — watch progress not recorded',
    )
    return
  }

  const [ep] = await db.select({ showId: episodes.showId }).from(episodes).where(eq(episodes.id, episodeId))
  if (!ep) {
    counters.itemsSkipped++
    return
  }

  const watched = isWatched(item.playheadSeconds, item.durationSeconds, item.fullyWatched)

  const [existing] = await db.select().from(userEpisodeProgress)
    .where(and(eq(userEpisodeProgress.userId, userId), eq(userEpisodeProgress.episodeId, episodeId)))

  const isNew = !existing
  if (isNew) counters.itemsNew++

  await db.insert(userEpisodeProgress).values({
    userId,
    episodeId,
    playheadSeconds: item.playheadSeconds ?? 0,
    watched,
    watchedAt: watched ? item.watchedAt : (existing?.watchedAt ?? null),
    lastEventAt: item.watchedAt,
  }).onConflictDoUpdate({
    target: [userEpisodeProgress.userId, userEpisodeProgress.episodeId],
    set: {
      playheadSeconds: sql`GREATEST(user_episode_progress.playhead_seconds, EXCLUDED.playhead_seconds)`,
      watched: sql`user_episode_progress.watched OR EXCLUDED.watched`,
      watchedAt: sql`COALESCE(user_episode_progress.watched_at, EXCLUDED.watched_at)`,
      lastEventAt: sql`GREATEST(user_episode_progress.last_event_at, EXCLUDED.last_event_at)`,
    },
  })

  await db.insert(userShowState).values({
    userId,
    showId: ep.showId,
    status: 'in_progress',
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing()

  touchedShowIds.add(ep.showId)
  counters.itemsIngested++
}

async function recomputeAndFinalize(
  db: DbClient,
  userId: string,
  providerKey: string,
  runId: string,
  touchedShowIds: Iterable<string>,
  counters: IngestCounters,
): Promise<void> {
  for (const showId of touchedShowIds) {
    await recomputeUserShowState(db, userId, showId)
  }

  await db.update(userServices)
    .set({ lastSyncAt: new Date(), lastError: null })
    .where(and(eq(userServices.userId, userId), eq(userServices.providerKey, providerKey)))

  await db.update(syncRuns)
    .set({
      status: 'success',
      finishedAt: new Date(),
      itemsIngested: counters.itemsIngested,
      itemsNew: counters.itemsNew,
    })
    .where(eq(syncRuns.id, runId))
}

export async function markUserServiceConnected(db: DbClient, userId: string, providerKey: string): Promise<void> {
  await db.insert(userServices).values({
    userId,
    providerKey,
    status: 'connected',
    lastTestedAt: new Date(),
  }).onConflictDoUpdate({
    target: [userServices.userId, userServices.providerKey],
    set: {
      status: 'connected',
      lastTestedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    },
  })
}

async function markRunError(db: DbClient, runId: string, counters: IngestCounters, step: string, message: string): Promise<void> {
  await db.update(syncRuns)
    .set({
      status: 'error',
      finishedAt: new Date(),
      itemsIngested: counters.itemsIngested,
      errors: [{ step, message }],
    })
    .where(eq(syncRuns.id, runId))
}

/**
 * Ingest one chunk of items+shows against an already-running sync run.
 *
 * Idempotent and safe to call many times for the same runId. Tracks touched
 * shows and counter deltas in Redis; the caller must call
 * `finalizeIngestRun` once the stream has drained to run the final state
 * recompute and mark the run `success`.
 */
export async function ingestChunk(
  db: DbClient,
  userId: string,
  providerKey: string,
  items: HistoryItem[],
  showTrees: ShowTree[],
  runId: string,
  enrichmentQueue: Queue<EnrichmentJobData> | null,
  redis: Redis,
): Promise<IngestCounters> {
  const showsByExt = new Map(showTrees.map((s) => [s.externalId, s]))
  const resolveShow: ShowResolver = async (externalShowId) => showsByExt.get(externalShowId) ?? null

  const touchedShowIds = new Set<string>()
  const counters: IngestCounters = { itemsIngested: 0, itemsNew: 0, itemsSkipped: 0 }

  await markUserServiceConnected(db, userId, providerKey)

  try {
    for (const item of items) {
      await processHistoryItem(db, userId, providerKey, item, resolveShow, touchedShowIds, counters, enrichmentQueue)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId }, 'Ingest chunk failed')
    await markRunError(db, runId, counters, 'chunk', message)
    throw err
  }

  logger.info(
    {
      runId,
      providerKey,
      itemsReceived: items.length,
      showsReceived: showTrees.length,
      itemsIngested: counters.itemsIngested,
      itemsSkipped: counters.itemsSkipped,
      itemsNew: counters.itemsNew,
    },
    'Ingest chunk processed',
  )

  if (touchedShowIds.size > 0 || counters.itemsIngested > 0 || counters.itemsNew > 0) {
    const touchedKey = runKey(providerKey, runId, 'touched')
    const ingestedKey = runKey(providerKey, runId, 'ingested')
    const newKey = runKey(providerKey, runId, 'new')

    const pipeline = redis.multi()
    if (touchedShowIds.size > 0) pipeline.sadd(touchedKey, ...touchedShowIds)
    if (counters.itemsIngested > 0) pipeline.incrby(ingestedKey, counters.itemsIngested)
    if (counters.itemsNew > 0) pipeline.incrby(newKey, counters.itemsNew)
    pipeline.expire(touchedKey, RUN_KEY_TTL_SECONDS)
    pipeline.expire(ingestedKey, RUN_KEY_TTL_SECONDS)
    pipeline.expire(newKey, RUN_KEY_TTL_SECONDS)
    await pipeline.exec()
  }

  return counters
}

/**
 * Close out a streaming sync run: recompute state for every show touched
 * across all chunks, update `userServices.lastSyncAt`, mark the run success,
 * and return the aggregated counters.
 */
export async function finalizeIngestRun(
  db: DbClient,
  userId: string,
  providerKey: string,
  runId: string,
  redis: Redis,
): Promise<IngestCounters> {
  const touchedKey = runKey(providerKey, runId, 'touched')
  const ingestedKey = runKey(providerKey, runId, 'ingested')
  const newKey = runKey(providerKey, runId, 'new')

  const [touchedShowIds, ingestedRaw, newRaw] = await Promise.all([
    redis.smembers(touchedKey),
    redis.get(ingestedKey),
    redis.get(newKey),
  ])

  const counters: IngestCounters = {
    itemsIngested: ingestedRaw ? Number(ingestedRaw) : 0,
    itemsNew: newRaw ? Number(newRaw) : 0,
    itemsSkipped: 0,
  }

  try {
    await recomputeAndFinalize(db, userId, providerKey, runId, touchedShowIds, counters)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId }, 'Ingest finalize failed')
    await markRunError(db, runId, counters, 'finalize', message)
    throw err
  }

  await redis.del(touchedKey, ingestedKey, newKey)
  return counters
}

/**
 * Single-shot ingest: start → chunk → finalize in one call. Used by the
 * back-compat `/ingest` endpoint and tests. Extensions should prefer the
 * start/chunk/finalize protocol directly.
 */
export async function ingestItems(
  db: DbClient,
  userId: string,
  providerKey: string,
  items: HistoryItem[],
  showTrees: ShowTree[],
  runId: string,
  enrichmentQueue: Queue<EnrichmentJobData> | null = null,
  redis: Redis | null = null,
): Promise<IngestCounters> {
  if (redis) {
    await ingestChunk(db, userId, providerKey, items, showTrees, runId, enrichmentQueue, redis)
    return finalizeIngestRun(db, userId, providerKey, runId, redis)
  }

  const showsByExt = new Map(showTrees.map((s) => [s.externalId, s]))
  const resolveShow: ShowResolver = async (externalShowId) => showsByExt.get(externalShowId) ?? null

  const touchedShowIds = new Set<string>()
  const counters: IngestCounters = { itemsIngested: 0, itemsNew: 0, itemsSkipped: 0 }

  await markUserServiceConnected(db, userId, providerKey)

  try {
    for (const item of items) {
      await processHistoryItem(db, userId, providerKey, item, resolveShow, touchedShowIds, counters, enrichmentQueue)
    }
    await recomputeAndFinalize(db, userId, providerKey, runId, touchedShowIds, counters)
    return counters
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId }, 'Ingest failed')
    await markRunError(db, runId, counters, 'ingest', message)
    throw err
  }
}

async function resolveEpisode(
  db: DbClient,
  item: HistoryItem,
  providerKey: string,
  resolveShow: ShowResolver,
  enrichmentQueue: Queue<EnrichmentJobData> | null,
): Promise<string | null> {
  const [existing] = await db
    .select({ episodeId: episodeProviders.episodeId })
    .from(episodeProviders)
    .where(and(
      eq(episodeProviders.providerKey, providerKey),
      eq(episodeProviders.externalId, item.externalItemId),
    ))

  if (existing) return existing.episodeId

  const showExtId = item.externalShowId
  if (!showExtId) return null

  const [existingShow] = await db
    .select({ showId: showProviders.showId })
    .from(showProviders)
    .where(and(
      eq(showProviders.providerKey, providerKey),
      eq(showProviders.externalId, showExtId),
    ))

  let showId: string

  if (existingShow) {
    showId = existingShow.showId
    // Even though the show is known, the payload may carry seasons/episodes
    // that are new to us (e.g. a newly-aired season). Upsert the whole tree
    // so stateMachine can flip watched → new_content.
    const tree = await resolveShow(showExtId)
    if (tree) await upsertShowCatalog(db, showId, providerKey, tree.seasons)
  } else {
    const tree = await resolveShow(showExtId)
    if (!tree) return null

    const [newShow] = await db.insert(shows).values({
      canonicalTitle: tree.title,
      titleNormalized: tree.title.toLowerCase().replace(/[^\w\s]/g, ''),
      description: tree.description ?? null,
      coverUrl: tree.coverUrl ?? null,
      kind: (tree.kind ?? 'anime') as 'anime' | 'tv' | 'movie',
    }).onConflictDoNothing().returning({ id: shows.id })

    if (!newShow) {
      const [retry] = await db.select({ showId: showProviders.showId })
        .from(showProviders)
        .where(and(eq(showProviders.providerKey, providerKey), eq(showProviders.externalId, showExtId)))
      if (!retry) return null
      showId = retry.showId
      await upsertShowCatalog(db, showId, providerKey, tree.seasons)
    } else {
      showId = newShow.id
      await db.insert(showProviders).values({
        showId,
        providerKey,
        externalId: showExtId,
      }).onConflictDoNothing()

      if (enrichmentQueue) {
        await enqueueEnrichment(enrichmentQueue, showId)
      }

      await upsertShowCatalog(db, showId, providerKey, tree.seasons)
    }
  }

  const [resolved] = await db
    .select({ episodeId: episodeProviders.episodeId })
    .from(episodeProviders)
    .where(and(
      eq(episodeProviders.providerKey, providerKey),
      eq(episodeProviders.externalId, item.externalItemId),
    ))

  return resolved?.episodeId ?? null
}

export interface ResolvedShowCatalog {
  externalShowId: string
  known: boolean
  catalogSyncedAt: Date | null
  /** seasonNumber → max episode number known to be in episode_providers */
  seasonCoverage: Record<number, number>
}

/**
 * For each external show id, report whether Kyomiru has Crunchyroll catalog
 * data for it (episode_providers rows) and the per-season episode coverage.
 * The extension uses this to skip catalog fetches for shows already indexed,
 * routing them through the fast items-only path instead.
 */
export async function resolveShowCatalogStatus(
  db: DbClient,
  providerKey: string,
  externalShowIds: string[],
): Promise<ResolvedShowCatalog[]> {
  if (externalShowIds.length === 0) return []

  const spRows = await db
    .select({
      externalId: showProviders.externalId,
      showId: showProviders.showId,
      catalogSyncedAt: showProviders.catalogSyncedAt,
    })
    .from(showProviders)
    .where(and(
      eq(showProviders.providerKey, providerKey),
      inArray(showProviders.externalId, externalShowIds),
    ))

  const knownByExternalId = new Map(spRows.map((r) => [r.externalId, r]))
  const knownShowIds = spRows.map((r) => r.showId)

  // showId → { seasonNumber → maxEpisodeNumber }
  const showCoverageMap = new Map<string, Record<number, number>>()

  if (knownShowIds.length > 0) {
    const epRows = await db
      .select({
        showId: episodes.showId,
        seasonNumber: seasons.seasonNumber,
        maxEpisode: sql<number>`MAX(${episodes.episodeNumber})`,
      })
      .from(episodeProviders)
      .innerJoin(episodes, eq(episodeProviders.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(and(
        eq(episodeProviders.providerKey, providerKey),
        inArray(episodes.showId, knownShowIds),
      ))
      .groupBy(episodes.showId, seasons.seasonNumber)

    for (const row of epRows) {
      const coverage = showCoverageMap.get(row.showId) ?? {}
      coverage[row.seasonNumber] = Number(row.maxEpisode)
      showCoverageMap.set(row.showId, coverage)
    }
  }

  return externalShowIds.map((externalId) => {
    const sp = knownByExternalId.get(externalId)
    if (!sp) {
      return { externalShowId: externalId, known: false, catalogSyncedAt: null, seasonCoverage: {} }
    }
    return {
      externalShowId: externalId,
      known: true,
      catalogSyncedAt: sp.catalogSyncedAt,
      seasonCoverage: showCoverageMap.get(sp.showId) ?? {},
    }
  })
}
