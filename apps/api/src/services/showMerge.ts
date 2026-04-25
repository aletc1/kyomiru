import { eq, sql } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import {
  shows, showProviders, seasons, episodes,
  episodeProviders, userEpisodeProgress, userShowState,
} from '@kyomiru/db/schema'
import { logger } from '../util/logger.js'

export interface ShowMergeParams {
  kind: 'tmdb' | 'anilist'
  externalId: number
  canonicalShowId: string
  duplicateShowId: string
}

export interface ShowMergeResult {
  skipped: boolean
  episodesMapped: number
  uepMerged: number
  usersAffected: number
}

/**
 * Merge a duplicate `shows` row into a canonical row that already owns the
 * given external id. All child rows (show_providers, seasons, episodes,
 * episode_providers, user_episode_progress, user_show_state) are migrated
 * or cascade-deleted. Runs inside a single transaction guarded by a
 * pg_advisory_xact_lock keyed on the external id, so concurrent merge jobs
 * for the same tmdb_id / anilist_id are serialised automatically.
 *
 * After this function returns the caller should enqueue a showRefresh job for
 * the canonical show so that user_show_state totals are recomputed.
 */
export async function mergeShows(
  db: DbClient,
  params: ShowMergeParams,
): Promise<ShowMergeResult> {
  const { kind, externalId, canonicalShowId, duplicateShowId } = params

  return db.transaction(async (tx) => {
    // Serialise concurrent merges of the same external id.
    // pg_advisory_xact_lock is released automatically at transaction end.
    // Concurrent merge jobs for the same external id will block on this lock
    // (tying up a worker slot). With concurrency=2 that's an acceptable
    // trade-off vs. complicating the logic with try-lock-and-requeue.
    const lockKey = `show-merge-${kind}-${externalId}`
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`)

    const [canonical] = await tx.select().from(shows).where(eq(shows.id, canonicalShowId))
    const [duplicate] = await tx.select().from(shows).where(eq(shows.id, duplicateShowId))

    if (!canonical || !duplicate || canonical.id === duplicate.id) {
      return { skipped: true, episodesMapped: 0, uepMerged: 0, usersAffected: 0 }
    }

    // Guard: a prior merge may have already moved the external id away.
    const currentExternalId = kind === 'tmdb' ? canonical.tmdbId : canonical.anilistId
    if (currentExternalId !== externalId) {
      return { skipped: true, episodesMapped: 0, uepMerged: 0, usersAffected: 0 }
    }

    let episodesMapped = 0
    let uepMerged = 0
    const usersAffected = new Set<string>()

    // ── 1. Migrate show_providers ─────────────────────────────────────────────
    // The unique index (providerKey, externalId) means a given provider+id pair
    // belongs to exactly one show globally — so canonical can never already hold
    // a row that conflicts with one of dup's rows on the PK (showId, providerKey,
    // externalId). A single bulk UPDATE is safe.
    await tx.update(showProviders)
      .set({ showId: canonicalShowId })
      .where(eq(showProviders.showId, duplicateShowId))

    // ── 2. Build season map: dup season id → canonical season id ──────────────
    const [canonicalSeasons, dupSeasons] = await Promise.all([
      tx.select().from(seasons).where(eq(seasons.showId, canonicalShowId)),
      tx.select().from(seasons).where(eq(seasons.showId, duplicateShowId)),
    ])

    const canonicalSeasonByNum = new Map(canonicalSeasons.map((s) => [s.seasonNumber, s]))
    const seasonIdMap = new Map<string, string>() // dupSeasonId → canonicalSeasonId

    for (const ds of dupSeasons) {
      const existing = canonicalSeasonByNum.get(ds.seasonNumber)
      if (existing) {
        seasonIdMap.set(ds.id, existing.id)
      } else {
        const [inserted] = await tx.insert(seasons).values({
          showId: canonicalShowId,
          seasonNumber: ds.seasonNumber,
          title: ds.title,
          airDate: ds.airDate,
          episodeCount: ds.episodeCount,
          titles: ds.titles as Record<string, string>,
        }).onConflictDoUpdate({
          target: [seasons.showId, seasons.seasonNumber],
          set: {
            episodeCount: sql`GREATEST(${seasons.episodeCount}, EXCLUDED.episode_count)`,
            titles: sql`${seasons.titles} || EXCLUDED.titles`,
          },
        }).returning({ id: seasons.id })
        if (inserted) seasonIdMap.set(ds.id, inserted.id)
      }
    }

    // ── 3. Build episode map: dup episode id → canonical episode id ───────────
    // Episodes are matched by (canonicalSeasonId, episodeNumber). Missing episodes
    // are inserted on the canonical season. The ON CONFLICT DO UPDATE path handles
    // races and returns the winning row's id in both cases.
    const episodeIdMap = new Map<string, string>() // dupEpId → canonicalEpId

    for (const [dupSeasonId, canonicalSeasonId] of seasonIdMap) {
      const dupEps = await tx
        .select()
        .from(episodes)
        .where(eq(episodes.seasonId, dupSeasonId))

      for (const de of dupEps) {
        const [upserted] = await tx.insert(episodes).values({
          seasonId: canonicalSeasonId,
          showId: canonicalShowId,
          episodeNumber: de.episodeNumber,
          title: de.title,
          titles: de.titles as Record<string, string>,
          descriptions: de.descriptions as Record<string, string>,
          durationSeconds: de.durationSeconds,
          airDate: de.airDate,
        }).onConflictDoUpdate({
          target: [episodes.seasonId, episodes.episodeNumber],
          set: {
            titles: sql`${episodes.titles} || EXCLUDED.titles`,
            descriptions: sql`${episodes.descriptions} || EXCLUDED.descriptions`,
            durationSeconds: sql`COALESCE(${episodes.durationSeconds}, EXCLUDED.duration_seconds)`,
            airDate: sql`COALESCE(${episodes.airDate}, EXCLUDED.air_date)`,
          },
        }).returning({ id: episodes.id })

        if (upserted) {
          episodeIdMap.set(de.id, upserted.id)
          // Counts every dup-episode that produced a canonical row (insert OR
          // update). Reflects merge work done, not just brand-new inserts.
          episodesMapped++
        }
      }
    }

    // ── 4. Migrate episode_providers ──────────────────────────────────────────
    // PK is (episodeId, providerKey). If both shows have an entry for the same
    // (episode, provider) but different externalIds (e.g. regional re-encodes),
    // a naive UPDATE would collide on the PK. Guard with NOT EXISTS so only
    // non-conflicting rows are moved; conflicting dup rows stay on the dup
    // episode and get cleaned up by cascade delete in step 8 (canonical wins).
    for (const [dupEpId, canonicalEpId] of episodeIdMap) {
      await tx.execute(sql`
        UPDATE episode_providers AS ep
        SET episode_id = ${canonicalEpId}
        WHERE ep.episode_id = ${dupEpId}
          AND NOT EXISTS (
            SELECT 1 FROM episode_providers AS ep2
            WHERE ep2.episode_id = ${canonicalEpId}
              AND ep2.provider_key = ep.provider_key
          )
      `)
    }

    // ── 5. Migrate user_episode_progress ──────────────────────────────────────
    // Merge semantics mirror the ingest path: watched = OR, playhead = GREATEST,
    // watched_at = first-non-null, last_event_at = GREATEST. Dup-episode rows
    // are cascade-deleted when the dup show is deleted in step 8.
    for (const [dupEpId, canonicalEpId] of episodeIdMap) {
      const uepRows = await tx
        .select()
        .from(userEpisodeProgress)
        .where(eq(userEpisodeProgress.episodeId, dupEpId))
      for (const uep of uepRows) {
        await tx.insert(userEpisodeProgress).values({
          userId: uep.userId,
          episodeId: canonicalEpId,
          playheadSeconds: uep.playheadSeconds,
          watched: uep.watched,
          watchedAt: uep.watchedAt,
          lastEventAt: uep.lastEventAt,
        }).onConflictDoUpdate({
          target: [userEpisodeProgress.userId, userEpisodeProgress.episodeId],
          set: {
            playheadSeconds: sql`GREATEST(user_episode_progress.playhead_seconds, EXCLUDED.playhead_seconds)`,
            watched: sql`user_episode_progress.watched OR EXCLUDED.watched`,
            watchedAt: sql`COALESCE(user_episode_progress.watched_at, EXCLUDED.watched_at)`,
            lastEventAt: sql`GREATEST(user_episode_progress.last_event_at, EXCLUDED.last_event_at)`,
          },
        })
        uepMerged++
        usersAffected.add(uep.userId)
      }
    }

    // ── 6. Migrate user_show_state ────────────────────────────────────────────
    // If the user has both a canonical and a dup state, merge them. Sticky rule:
    // if either side is 'removed', the merged row stays 'removed'. Canonical
    // wins for user-set fields (rating, queue_position, kind_override).
    // Totals are left to be recomputed by the showRefresh job enqueued by the worker.
    const dupUssRows = await tx
      .select()
      .from(userShowState)
      .where(eq(userShowState.showId, duplicateShowId))

    const now = new Date()
    for (const uss of dupUssRows) {
      usersAffected.add(uss.userId)
      await tx.insert(userShowState).values({
        userId: uss.userId,
        showId: canonicalShowId,
        status: uss.status,
        prevStatus: uss.prevStatus,
        kindOverride: uss.kindOverride,
        rating: uss.rating,
        favoritedAt: uss.favoritedAt,
        queuePosition: uss.queuePosition,
        totalEpisodes: uss.totalEpisodes,
        watchedEpisodes: uss.watchedEpisodes,
        lastActivityAt: uss.lastActivityAt,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [userShowState.userId, userShowState.showId],
        set: {
          // Preserve 'removed' if either side is removed.
          status: sql`CASE WHEN user_show_state.status = 'removed' THEN user_show_state.status WHEN EXCLUDED.status = 'removed'::show_status THEN 'removed'::show_status ELSE user_show_state.status END`,
          // Canonical fields win; dup fills in nulls.
          kindOverride: sql`COALESCE(user_show_state.kind_override, EXCLUDED.kind_override)`,
          rating: sql`COALESCE(user_show_state.rating, EXCLUDED.rating)`,
          queuePosition: sql`COALESCE(user_show_state.queue_position, EXCLUDED.queue_position)`,
          prevStatus: sql`COALESCE(user_show_state.prev_status, EXCLUDED.prev_status)`,
          // favoritedAt: earliest of the two non-null values.
          favoritedAt: sql`CASE WHEN user_show_state.favorited_at IS NULL THEN EXCLUDED.favorited_at WHEN EXCLUDED.favorited_at IS NULL THEN user_show_state.favorited_at ELSE LEAST(user_show_state.favorited_at, EXCLUDED.favorited_at) END`,
          lastActivityAt: sql`GREATEST(user_show_state.last_activity_at, EXCLUDED.last_activity_at)`,
          updatedAt: sql`NOW()`,
        },
      })
    }

    // ── 7. Update canonical show metadata ─────────────────────────────────────
    // Canonical titles win for shared locales (spread order: dup first, then canonical).
    const mergedTitles = {
      ...(duplicate.titles as Record<string, string>),
      ...(canonical.titles as Record<string, string>),
    }
    const mergedDescriptions = {
      ...(duplicate.descriptions as Record<string, string>),
      ...(canonical.descriptions as Record<string, string>),
    }
    const mergedGenres = canonical.genres.length > 0 ? canonical.genres : duplicate.genres
    const mergedEnrichedAt =
      canonical.enrichedAt && duplicate.enrichedAt
        ? (canonical.enrichedAt > duplicate.enrichedAt ? canonical.enrichedAt : duplicate.enrichedAt)
        : (canonical.enrichedAt ?? duplicate.enrichedAt ?? null)

    await tx.update(shows).set({
      tmdbId: kind === 'tmdb' ? externalId : (canonical.tmdbId ?? duplicate.tmdbId ?? null),
      anilistId: kind === 'anilist' ? externalId : (canonical.anilistId ?? duplicate.anilistId ?? null),
      titles: mergedTitles,
      descriptions: mergedDescriptions,
      genres: mergedGenres,
      coverUrl: canonical.coverUrl ?? duplicate.coverUrl ?? null,
      year: canonical.year ?? duplicate.year ?? null,
      rating: canonical.rating ?? duplicate.rating ?? null,
      enrichedAt: mergedEnrichedAt,
    }).where(eq(shows.id, canonicalShowId))

    // ── 8. Delete duplicate show ───────────────────────────────────────────────
    // Cascades to: show_providers, seasons → episodes → episode_providers,
    // episodes → user_episode_progress, user_show_state.
    // All rows we needed have been migrated above; the rest are cleaned up here.
    await tx.delete(shows).where(eq(shows.id, duplicateShowId))

    logger.info({
      kind,
      externalId,
      canonicalShowId,
      duplicateShowId,
      canonicalTitle: canonical.canonicalTitle,
      duplicateTitle: duplicate.canonicalTitle,
      episodesMapped,
      uepMerged,
      usersAffected: usersAffected.size,
    }, 'show merge complete')

    return {
      skipped: false,
      episodesMapped,
      uepMerged,
      usersAffected: usersAffected.size,
    }
  })
}
