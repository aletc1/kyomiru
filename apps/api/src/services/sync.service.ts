import { eq, and, sql } from 'drizzle-orm'
import type { Queue } from 'bullmq'
import type { DbClient } from '@kyomiru/db/client'
import {
  userServices, watchEvents, episodeProviders, episodes,
  shows, showProviders, seasons, userEpisodeProgress,
  userShowState, syncRuns,
} from '@kyomiru/db/schema'
import type { Provider, HistoryItem, SeasonTree, ShowTree } from '@kyomiru/providers/types'
import { decrypt } from '../crypto/secretbox.js'
import { recomputeUserShowState } from './stateMachine.js'
import type { EnrichmentJobData } from '../workers/enrichmentWorker.js'
import { logger } from '../util/logger.js'

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
  if (!episodeId) return

  const [ep] = await db.select({ showId: episodes.showId }).from(episodes).where(eq(episodes.id, episodeId))
  if (!ep) return

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

async function finalizeSyncRun(
  db: DbClient,
  userId: string,
  providerKey: string,
  runId: string,
  touchedShowIds: Set<string>,
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

/**
 * Ingest a batch of history items that were collected by an external client
 * (e.g. the Chrome extension). Shows arrive pre-packed — no provider calls.
 */
export async function ingestItems(
  db: DbClient,
  userId: string,
  providerKey: string,
  items: HistoryItem[],
  showTrees: ShowTree[],
  runId: string,
  enrichmentQueue: Queue<EnrichmentJobData> | null = null,
): Promise<IngestCounters> {
  const showsByExt = new Map(showTrees.map((s) => [s.externalId, s]))
  const resolveShow: ShowResolver = async (externalShowId) => showsByExt.get(externalShowId) ?? null

  const touchedShowIds = new Set<string>()
  const counters: IngestCounters = { itemsIngested: 0, itemsNew: 0 }

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

  try {
    for (const item of items) {
      await processHistoryItem(db, userId, providerKey, item, resolveShow, touchedShowIds, counters, enrichmentQueue)
    }

    await finalizeSyncRun(db, userId, providerKey, runId, touchedShowIds, counters)
    return counters
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId }, 'Ingest failed')

    await db.update(syncRuns)
      .set({
        status: 'error',
        finishedAt: new Date(),
        itemsIngested: counters.itemsIngested,
        errors: [{ step: 'ingest', message }],
      })
      .where(eq(syncRuns.id, runId))

    throw err
  }
}

export async function runSync(
  db: DbClient,
  userId: string,
  providerKey: string,
  provider: Provider,
  secretKey: string,
  runId: string,
  enrichmentQueue: Queue<EnrichmentJobData> | null = null,
): Promise<void> {
  const [svc] = await db
    .select()
    .from(userServices)
    .where(and(eq(userServices.userId, userId), eq(userServices.providerKey, providerKey)))

  if (!svc?.encryptedSecret || !svc.secretNonce) {
    throw new Error('No credentials stored')
  }

  const plaintext = await decrypt(svc.encryptedSecret, svc.secretNonce, secretKey)
  const { token } = JSON.parse(plaintext) as { token: string }

  const touchedShowIds = new Set<string>()
  const counters: IngestCounters = { itemsIngested: 0, itemsNew: 0 }

  try {
    const authToken = await provider.authenticate({ token })
    const resolveShow: ShowResolver = (externalShowId) => provider.fetchShowMetadata(externalShowId, authToken)

    for await (const page of provider.fetchHistorySince({ token }, svc.lastCursor as Record<string, unknown> | null)) {
      for (const item of page.items) {
        await processHistoryItem(db, userId, providerKey, item, resolveShow, touchedShowIds, counters, enrichmentQueue)
      }

      if (page.nextCursor) {
        await db.update(userServices)
          .set({ lastCursor: page.nextCursor })
          .where(and(eq(userServices.userId, userId), eq(userServices.providerKey, providerKey)))
      }
    }

    await finalizeSyncRun(db, userId, providerKey, runId, touchedShowIds, counters)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err, runId }, 'Sync failed')

    await db.update(syncRuns)
      .set({
        status: 'error',
        finishedAt: new Date(),
        itemsIngested: counters.itemsIngested,
        errors: [{ step: 'sync', message }],
      })
      .where(eq(syncRuns.id, runId))

    await db.update(userServices)
      .set({ lastError: message, status: message.includes('401') || message.includes('auth') ? 'error' : 'connected' })
      .where(and(eq(userServices.userId, userId), eq(userServices.providerKey, providerKey)))

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
        await enrichmentQueue.add(
          'enrich',
          { showId },
          { jobId: `enrich-${showId}`, removeOnComplete: 100, removeOnFail: 500 },
        )
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
