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
import { enqueueShowRefresh, type ShowRefreshJobData } from '../workers/showRefreshWorker.js'
import { logger } from '../util/logger.js'

const RUN_KEY_TTL_SECONDS = 3600
// Batch size for multi-row INSERTs — stays well under Postgres's 65 535 parameter limit.
const INSERT_BATCH = 500

function runKey(providerKey: string, runId: string, suffix: string): string {
  return `kyomiru:sync:${providerKey}:${runId}:${suffix}`
}

const WATCHED_THRESHOLD = 0.9

export type SeasonInsertValue = {
  showId: string
  seasonNumber: number
  title: string | null
  airDate: string | null
  episodeCount: number
  titles: Record<string, string>
}

/**
 * Merge two in-batch season values that target the same (showId, seasonNumber).
 * Mirrors the SQL `ON CONFLICT DO UPDATE` semantics for columns the SQL
 * touches: `episodeCount = GREATEST(...)` and `titles` JSONB merge with
 * EXCLUDED winning shared keys.
 *
 * `title` and `airDate` use first-non-null-wins. The SQL ON CONFLICT clause
 * does not update those columns, so this choice only affects the INSERT path
 * (i.e. when the season row does not yet exist in the DB).
 */
export function mergeSeasonInBatch(prev: SeasonInsertValue, next: SeasonInsertValue): SeasonInsertValue {
  return {
    showId: prev.showId,
    seasonNumber: prev.seasonNumber,
    title: prev.title ?? next.title,
    airDate: prev.airDate ?? next.airDate,
    episodeCount: Math.max(prev.episodeCount, next.episodeCount),
    titles: { ...prev.titles, ...next.titles },
  }
}

/**
 * Merge two in-batch episode values that target the same (seasonId, episodeNumber).
 * Mirrors the SQL `ON CONFLICT DO UPDATE` clause: COALESCE(existing, EXCLUDED)
 * for scalar fields and JSONB merge with EXCLUDED winning shared keys.
 */
export function mergeEpisodeInBatch(
  prev: typeof episodes.$inferInsert,
  next: typeof episodes.$inferInsert,
): typeof episodes.$inferInsert {
  return {
    seasonId: prev.seasonId,
    showId: prev.showId,
    episodeNumber: prev.episodeNumber,
    title: prev.title ?? next.title ?? null,
    titles: { ...(prev.titles as Record<string, string>), ...(next.titles as Record<string, string>) },
    descriptions: { ...(prev.descriptions as Record<string, string>), ...(next.descriptions as Record<string, string>) },
    durationSeconds: prev.durationSeconds ?? next.durationSeconds ?? null,
    airDate: prev.airDate ?? next.airDate ?? null,
  }
}

/**
 * Upsert a show's full season/episode tree.
 *
 * Idempotent via ON CONFLICT on the natural keys. Uses bulk SQL so the number
 * of round-trips is O(1) rather than O(seasons × episodes).
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
  if (seasonTrees.length === 0) return

  if (providerKey) {
    await db.update(showProviders)
      .set({ catalogSyncedAt: new Date() })
      .where(and(eq(showProviders.showId, showId), eq(showProviders.providerKey, providerKey)))
  }

  // ── Bulk upsert all seasons ────────────────────────────────────────────────
  // Dedupe by seasonNumber so the bulk INSERT never carries two rows targeting
  // the same (showId, seasonNumber) — Postgres rejects "ON CONFLICT DO UPDATE
  // command cannot affect row a second time" when that happens. IngestOrdinal
  // floors fractional values, so Crunchyroll season 2 + season 2.5 (OVA arc)
  // collapse to the same integer. See mergeSeasonInBatch for merge semantics.
  const seasonByNumber = new Map<number, SeasonInsertValue>()
  for (const s of seasonTrees) {
    const next: SeasonInsertValue = {
      showId,
      seasonNumber: s.number,
      title: s.title ?? null,
      airDate: s.airDate ?? null,
      episodeCount: s.episodes.length,
      titles: (s.titles ?? (s.title ? { en: s.title } : {})) as Record<string, string>,
    }
    const prev = seasonByNumber.get(s.number)
    seasonByNumber.set(s.number, prev ? mergeSeasonInBatch(prev, next) : next)
  }
  const seasonValues = [...seasonByNumber.values()]

  const insertedSeasons: { id: string; seasonNumber: number }[] = []
  for (let i = 0; i < seasonValues.length; i += INSERT_BATCH) {
    const rows = await db.insert(seasons)
      .values(seasonValues.slice(i, i + INSERT_BATCH))
      .onConflictDoUpdate({
        target: [seasons.showId, seasons.seasonNumber],
        set: {
          episodeCount: sql`GREATEST(${seasons.episodeCount}, EXCLUDED.episode_count)`,
          titles: sql`${seasons.titles} || EXCLUDED.titles`,
        },
      })
      .returning({ id: seasons.id, seasonNumber: seasons.seasonNumber })
    insertedSeasons.push(...rows)
  }

  const seasonIdByNumber = new Map(insertedSeasons.map((s) => [s.seasonNumber, s.id]))

  // ── Collect all episodes + their external IDs ──────────────────────────────
  // Same dedup rationale as seasons: episodes 11 and 11.5 (recap special) both
  // floor to episodeNumber 11 in IngestOrdinal and would collide on the bulk
  // INSERT's (seasonId, episodeNumber) conflict target. See mergeEpisodeInBatch.
  const episodeByKey = new Map<string, typeof episodes.$inferInsert>()
  // Parallel list that maps each episode value to its external provider ID (if any).
  const episodeExternalIds: Array<{ seasonId: string; episodeNumber: number; externalId: string }> = []

  for (const s of seasonTrees) {
    const seasonId = seasonIdByNumber.get(s.number)
    if (!seasonId) continue
    for (const e of s.episodes) {
      const epTitles = (e.titles ?? (e.title ? { en: e.title } : {})) as Record<string, string>
      const next: typeof episodes.$inferInsert = {
        seasonId,
        showId,
        episodeNumber: e.number,
        title: e.title ?? null,
        titles: epTitles,
        descriptions: (e.descriptions ?? {}) as Record<string, string>,
        durationSeconds: e.durationSeconds ?? null,
        airDate: e.airDate ?? null,
      }
      const key = `${seasonId}:${e.number}`
      const prev = episodeByKey.get(key)
      episodeByKey.set(key, prev ? mergeEpisodeInBatch(prev, next) : next)
      if (e.externalId) {
        episodeExternalIds.push({ seasonId, episodeNumber: e.number, externalId: e.externalId })
      }
    }
  }

  const allEpisodeValues = [...episodeByKey.values()]

  if (allEpisodeValues.length === 0) return

  // ── Bulk upsert episodes in batches ───────────────────────────────────────
  const insertedEps: { id: string; seasonId: string; episodeNumber: number }[] = []

  for (let i = 0; i < allEpisodeValues.length; i += INSERT_BATCH) {
    const rows = await db.insert(episodes)
      .values(allEpisodeValues.slice(i, i + INSERT_BATCH))
      .onConflictDoUpdate({
        target: [episodes.seasonId, episodes.episodeNumber],
        set: {
          title: sql`COALESCE(${episodes.title}, EXCLUDED.title)`,
          titles: sql`${episodes.titles} || EXCLUDED.titles`,
          descriptions: sql`${episodes.descriptions} || EXCLUDED.descriptions`,
          durationSeconds: sql`COALESCE(${episodes.durationSeconds}, EXCLUDED.duration_seconds)`,
          airDate: sql`COALESCE(${episodes.airDate}, EXCLUDED.air_date)`,
        },
      })
      .returning({ id: episodes.id, seasonId: episodes.seasonId, episodeNumber: episodes.episodeNumber })
    insertedEps.push(...rows)
  }

  if (!providerKey || episodeExternalIds.length === 0) return

  // ── Bulk insert episode_providers ─────────────────────────────────────────
  // When two source episodes share a floored episodeNumber (e.g. 11 and 11.5),
  // both attempt to insert episode_providers rows pointing at the same shared
  // episode.id with the same providerKey. The PK is (episodeId, providerKey),
  // so only the first-encountered externalId persists; the second collides and
  // is dropped by onConflictDoNothing. The unique index on
  // (providerKey, externalId) means we couldn't store both anyway — the schema
  // permits at most one externalId per (episode, provider).
  const episodeIdByKey = new Map(insertedEps.map((ep) => [`${ep.seasonId}:${ep.episodeNumber}`, ep.id]))

  const epProviderValues: (typeof episodeProviders.$inferInsert)[] = []
  for (const ee of episodeExternalIds) {
    const episodeId = episodeIdByKey.get(`${ee.seasonId}:${ee.episodeNumber}`)
    if (episodeId) epProviderValues.push({ episodeId, providerKey, externalId: ee.externalId })
  }

  for (let i = 0; i < epProviderValues.length; i += INSERT_BATCH) {
    await db.insert(episodeProviders)
      .values(epProviderValues.slice(i, i + INSERT_BATCH))
      .onConflictDoNothing()
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

// ── Legacy per-item helpers (used only by the no-Redis ingestItems path) ──────

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
  showRefreshQueue: Queue<ShowRefreshJobData> | null = null,
): Promise<void> {
  // Recompute the syncing user inline so the finalize response observes fresh
  // (total, watched). The queue job recomputes ALL library users for fanout —
  // the syncing user is recomputed twice, which is idempotent and harmless.
  for (const showId of touchedShowIds) {
    await recomputeUserShowState(db, userId, showId)
    if (showRefreshQueue) await enqueueShowRefresh(showRefreshQueue, showId)
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
 * Uses bulk SQL (one query per table, batched by INSERT_BATCH rows) rather
 * than per-item queries. All user-facing writes (watch_events,
 * user_episode_progress, user_show_state) are wrapped in a single transaction
 * so a partial failure leaves no half-written rows.
 *
 * Catalog upserts happen outside the transaction — they write global show
 * data and must be visible before the transaction resolves episode IDs.
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
  const counters: IngestCounters = { itemsIngested: 0, itemsNew: 0, itemsSkipped: 0 }
  const touchedShowIds = new Set<string>()

  await markUserServiceConnected(db, userId, providerKey)

  try {
    const showsByExt = new Map(showTrees.map((s) => [s.externalId, s]))

    // All external show IDs referenced by items in this chunk.
    const allExtShowIds = [...new Set(
      items.flatMap((i) => (i.externalShowId ? [i.externalShowId] : []))
    )]

    // ── Step 1: Bulk resolve known shows ──────────────────────────────────────
    const showIdByExtId = new Map<string, string>()
    if (allExtShowIds.length > 0) {
      const spRows = await db
        .select({ externalId: showProviders.externalId, showId: showProviders.showId })
        .from(showProviders)
        .where(and(
          eq(showProviders.providerKey, providerKey),
          inArray(showProviders.externalId, allExtShowIds),
        ))
      for (const r of spRows) showIdByExtId.set(r.externalId, r.showId)
    }

    // ── Step 2: Insert new shows (typically ≤ a handful per chunk) ────────────
    // These are sequential to handle the race-condition fallback cleanly.
    // Enrichment is collected here and enqueued AFTER the write transaction so
    // the merge worker cannot delete episodes (via cascade) between step 4
    // (episode ID resolution) and step 6 (user_episode_progress insert).
    const showIdsToEnrich: string[] = []
    const newExtIds = allExtShowIds.filter((id) => !showIdByExtId.has(id) && showsByExt.has(id))
    for (const extId of newExtIds) {
      const tree = showsByExt.get(extId)!
      const [newShow] = await db.insert(shows).values({
        canonicalTitle: tree.title,
        titleNormalized: tree.title.toLowerCase().replace(/[^\w\s]/g, ''),
        description: tree.description ?? null,
        coverUrl: tree.coverUrl ?? null,
        kind: (tree.kind ?? 'anime') as 'anime' | 'tv' | 'movie',
        titles: { en: tree.title },
        descriptions: tree.description ? { en: tree.description } : {},
      }).onConflictDoNothing().returning({ id: shows.id })

      if (newShow) {
        await db.insert(showProviders).values({
          showId: newShow.id,
          providerKey,
          externalId: extId,
        }).onConflictDoNothing()
        showIdByExtId.set(extId, newShow.id)
        showIdsToEnrich.push(newShow.id)
      } else {
        // Race: another concurrent request already inserted this show; use its id.
        const [existing] = await db
          .select({ showId: showProviders.showId })
          .from(showProviders)
          .where(and(eq(showProviders.providerKey, providerKey), eq(showProviders.externalId, extId)))
        if (existing) showIdByExtId.set(extId, existing.showId)
      }
    }

    // ── Step 3: Upsert catalogs for shows whose tree was sent in this chunk ───
    // Fast path (Phase A) sends shows=[] so this is a no-op for incremental syncs.
    for (const [extId, showId] of showIdByExtId) {
      const tree = showsByExt.get(extId)
      if (tree && tree.seasons.length > 0) {
        await upsertShowCatalog(db, showId, providerKey, tree.seasons)
      }
    }

    // ── Step 4: Bulk resolve external item IDs → episode IDs ──────────────────
    const allItemExtIds = items.map((i) => i.externalItemId)
    const episodeIdByExtItemId = new Map<string, string>()

    for (let i = 0; i < allItemExtIds.length; i += INSERT_BATCH) {
      const slice = allItemExtIds.slice(i, i + INSERT_BATCH)
      const epRows = await db
        .select({ externalId: episodeProviders.externalId, episodeId: episodeProviders.episodeId })
        .from(episodeProviders)
        .where(and(
          eq(episodeProviders.providerKey, providerKey),
          inArray(episodeProviders.externalId, slice),
        ))
      for (const r of epRows) episodeIdByExtItemId.set(r.externalId, r.episodeId)
    }

    // ── Step 5: Resolve episode → showId ─────────────────────────────────────
    const resolvedEpIds = [...new Set(episodeIdByExtItemId.values())]
    const showIdByEpisodeId = new Map<string, string>()

    for (let i = 0; i < resolvedEpIds.length; i += INSERT_BATCH) {
      const slice = resolvedEpIds.slice(i, i + INSERT_BATCH)
      const epRows = await db
        .select({ id: episodes.id, showId: episodes.showId })
        .from(episodes)
        .where(inArray(episodes.id, slice))
      for (const r of epRows) showIdByEpisodeId.set(r.id, r.showId)
    }

    const resolvedItems = items.filter((item) => episodeIdByExtItemId.has(item.externalItemId))
    counters.itemsSkipped = items.length - resolvedItems.length

    if (resolvedItems.length > 0) {
      // ── Step 6: All user-facing writes in a single transaction ────────────
      // Counters and touchedShowIds are populated inside the callback and only
      // applied to the outer scope after a successful commit.
      const txResult = await db.transaction(async (tx) => {
        // 6a. Bulk insert watch_events (idempotent via ON CONFLICT DO NOTHING)
        for (let i = 0; i < items.length; i += INSERT_BATCH) {
          await tx.insert(watchEvents)
            .values(items.slice(i, i + INSERT_BATCH).map((item) => ({
              userId,
              providerKey,
              externalItemId: item.externalItemId,
              watchedAt: item.watchedAt,
              playheadSeconds: item.playheadSeconds ?? null,
              durationSeconds: item.durationSeconds ?? null,
              fullyWatched: item.fullyWatched ?? false,
              raw: (item.raw ?? {}) as Record<string, unknown>,
            })))
            .onConflictDoNothing()
        }

        // 6b. Re-validate episode IDs inside the transaction to guard against a
        // race where the merge worker deletes an episode between step 4 (episode
        // resolution, outside this transaction) and here. Episodes deleted by a
        // concurrent merge are silently skipped — their watch_event is still recorded.
        // A narrow residual race remains: under READ COMMITTED, a merge that
        // commits between this SELECT and the user_episode_progress INSERT below
        // can still cause an FK violation. Acceptable because deferred enrichment
        // (above) eliminates the self-triggered case, which is the common one.
        const outerEpIds = [...new Set(resolvedItems.map((item) => episodeIdByExtItemId.get(item.externalItemId)!))]
        const stillExistingEpSet = new Set<string>()
        for (let i = 0; i < outerEpIds.length; i += INSERT_BATCH) {
          const slice = outerEpIds.slice(i, i + INSERT_BATCH)
          const rows = await tx.select({ id: episodes.id }).from(episodes).where(inArray(episodes.id, slice))
          for (const r of rows) stillExistingEpSet.add(r.id)
        }
        const validResolvedItems = stillExistingEpSet.size < outerEpIds.length
          ? resolvedItems.filter((item) => {
              const epId = episodeIdByExtItemId.get(item.externalItemId)
              return epId !== undefined && stillExistingEpSet.has(epId)
            })
          : resolvedItems

        // 6c. Check which progress rows already exist to count itemsNew correctly.
        const resolvedEpIdsForItems = validResolvedItems.map(
          (item) => episodeIdByExtItemId.get(item.externalItemId)!
        )
        const existingProgress = resolvedEpIdsForItems.length > 0
          ? await tx
              .select({ episodeId: userEpisodeProgress.episodeId })
              .from(userEpisodeProgress)
              .where(and(
                eq(userEpisodeProgress.userId, userId),
                inArray(userEpisodeProgress.episodeId, resolvedEpIdsForItems),
              ))
          : []
        const existingSet = new Set(existingProgress.map((r) => r.episodeId))

        // 6d. Build progress rows, deduping by episodeId so the bulk INSERT
        // never carries two rows targeting the same (userId, episodeId) — Postgres
        // rejects "ON CONFLICT DO UPDATE command cannot affect row a second time"
        // when that happens. Multiple items per episode are realistic: Netflix
        // movieIDs repeat across re-watches and Crunchyroll panel.id can too.
        // Within-chunk values are merged with the same semantics as the SQL
        // ON CONFLICT clause, and each episodeId is counted as new at most once.
        let localIngested = 0
        let localNew = 0
        const localTouched = new Set<string>()
        const seenNewEpisodes = new Set<string>()
        const progressByEpisode = new Map<string, typeof userEpisodeProgress.$inferInsert>()

        for (const item of validResolvedItems) {
          const episodeId = episodeIdByExtItemId.get(item.externalItemId)!
          const watched = isWatched(item.playheadSeconds, item.durationSeconds, item.fullyWatched)

          localIngested++
          if (!existingSet.has(episodeId) && !seenNewEpisodes.has(episodeId)) {
            localNew++
            seenNewEpisodes.add(episodeId)
          }

          const showId = showIdByEpisodeId.get(episodeId)
          if (showId) localTouched.add(showId)

          const newRow: typeof userEpisodeProgress.$inferInsert = {
            userId,
            episodeId,
            playheadSeconds: item.playheadSeconds ?? 0,
            watched,
            watchedAt: watched ? item.watchedAt : null,
            lastEventAt: item.watchedAt,
          }

          const prev = progressByEpisode.get(episodeId)
          if (!prev) {
            progressByEpisode.set(episodeId, newRow)
          } else {
            // First non-null wins, matching COALESCE(existing, EXCLUDED) semantics.
            const mergedWatchedAt: Date | null = prev.watchedAt ?? newRow.watchedAt ?? null
            const prevLast = prev.lastEventAt as Date
            const newLast = newRow.lastEventAt as Date
            progressByEpisode.set(episodeId, {
              userId,
              episodeId,
              playheadSeconds: Math.max(prev.playheadSeconds ?? 0, newRow.playheadSeconds ?? 0),
              watched: Boolean(prev.watched) || Boolean(newRow.watched),
              watchedAt: mergedWatchedAt,
              lastEventAt: prevLast >= newLast ? prevLast : newLast,
            })
          }
        }

        const progressValues = [...progressByEpisode.values()]

        // 6e. Bulk upsert user_episode_progress
        for (let i = 0; i < progressValues.length; i += INSERT_BATCH) {
          await tx.insert(userEpisodeProgress)
            .values(progressValues.slice(i, i + INSERT_BATCH))
            .onConflictDoUpdate({
              target: [userEpisodeProgress.userId, userEpisodeProgress.episodeId],
              set: {
                playheadSeconds: sql`GREATEST(user_episode_progress.playhead_seconds, EXCLUDED.playhead_seconds)`,
                watched: sql`user_episode_progress.watched OR EXCLUDED.watched`,
                watchedAt: sql`COALESCE(user_episode_progress.watched_at, EXCLUDED.watched_at)`,
                lastEventAt: sql`GREATEST(user_episode_progress.last_event_at, EXCLUDED.last_event_at)`,
              },
            })
        }

        // 6f. Ensure user_show_state rows exist (ON CONFLICT DO NOTHING preserves status/rating).
        if (localTouched.size > 0) {
          const now = new Date()
          await tx.insert(userShowState)
            .values([...localTouched].map((showId) => ({
              userId,
              showId,
              status: 'in_progress' as const,
              lastActivityAt: now,
              updatedAt: now,
            })))
            .onConflictDoNothing()
        }

        return { localIngested, localNew, localTouched }
      })

      // Apply transaction results to outer counters only after successful commit.
      counters.itemsIngested = txResult.localIngested
      counters.itemsNew = txResult.localNew
      for (const id of txResult.localTouched) touchedShowIds.add(id)
    }

    // Enqueue enrichment after user_episode_progress is safely committed so the
    // merge worker cannot race against an in-flight write transaction.
    if (enrichmentQueue && showIdsToEnrich.length > 0) {
      await Promise.all(showIdsToEnrich.map((showId) => enqueueEnrichment(enrichmentQueue, showId)))
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
  showRefreshQueue: Queue<ShowRefreshJobData> | null = null,
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
    await recomputeAndFinalize(db, userId, providerKey, runId, touchedShowIds, counters, showRefreshQueue)
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
  showRefreshQueue: Queue<ShowRefreshJobData> | null = null,
): Promise<IngestCounters> {
  if (redis) {
    await ingestChunk(db, userId, providerKey, items, showTrees, runId, enrichmentQueue, redis)
    return finalizeIngestRun(db, userId, providerKey, runId, redis, showRefreshQueue)
  }

  // Legacy path (no Redis — used by tests without a Redis instance).
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
      titles: { en: tree.title },
      descriptions: tree.description ? { en: tree.description } : {},
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
 * For each external show id, report whether Kyomiru has provider catalog
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
