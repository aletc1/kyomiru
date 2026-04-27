import { eq, and, count, sql, desc } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import { userEpisodeProgress, userShowState, episodes, episodeProviders, seasons, type showStatusEnum } from '@kyomiru/db/schema'

type ShowStatus = typeof showStatusEnum.enumValues[number]

// Episodes with a future air_date are excluded from state-machine counts so a
// currently-airing show doesn't sit forever at "3/12 in_progress". A NULL
// air_date means we don't know — extension-only shows (Netflix history-only
// fallback) write episodes without dates — and we count those as aired.
export const airedEpisodesFilter = () =>
  sql`(${episodes.airDate} IS NULL OR ${episodes.airDate} <= CURRENT_DATE)`

export interface StatusInput {
  total: number
  watched: number
  // True when the latest aired season has no watched episodes. Drives the new_content rule.
  latestAiredSeasonUnwatched: boolean
  // True when there is at least one episode with a known past/today air_date that the user hasn't watched.
  hasActionable: boolean
  // True when there is at least one episode with a known future air_date.
  hasUpcoming: boolean
  existingStatus: ShowStatus
  existingTotalEpisodes: number
  existingQueuePosition: number | null
}

export interface StatusResult {
  status: ShowStatus
  queuePosition: number | null
}

export function decideShowStatus(input: StatusInput): StatusResult {
  const {
    total, watched, latestAiredSeasonUnwatched,
    hasActionable, hasUpcoming,
    existingStatus, existingTotalEpisodes, existingQueuePosition,
  } = input

  let status: ShowStatus

  if (total > 0 && watched === total && !hasUpcoming) {
    // 1a: Fully caught up, no future episodes scheduled → watched
    status = 'watched'
  } else if (total > 0 && watched === total && hasUpcoming) {
    // 1b: Fully caught up (no NULL placeholders) but future eps scheduled → coming_soon
    status = 'coming_soon'
  } else if (!hasActionable && hasUpcoming && watched > 0) {
    // CS: Placeholder-padded shows — user is caught up on all dated released eps
    // but T > W due to NULL placeholders. Future eps are scheduled → coming_soon.
    status = 'coming_soon'
  } else if ((existingStatus === 'watched' || existingStatus === 'coming_soon') && hasActionable && total > existingTotalEpisodes) {
    // 2: A new dated episode appeared that the user hasn't watched → new_content
    status = 'new_content'
  } else if (existingStatus === 'new_content' && hasActionable) {
    // 3: Sticky new_content — only while there is something actionable to watch
    status = 'new_content'
  } else if (watched > 0 && hasActionable && latestAiredSeasonUnwatched) {
    // 4: User has started the show; the latest aired season is fully unwatched → new_content
    status = 'new_content'
  } else {
    status = 'in_progress'
  }

  return { status, queuePosition: status === 'watched' ? null : existingQueuePosition }
}

export async function recomputeUserShowState(
  db: DbClient,
  userId: string,
  showId: string,
): Promise<void> {
  const [totalRow] = await db
    .select({ count: count() })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), airedEpisodesFilter()))

  const total = totalRow?.count ?? 0

  const [watchedRow] = await db
    .select({ count: count() })
    .from(userEpisodeProgress)
    .innerJoin(episodes, eq(userEpisodeProgress.episodeId, episodes.id))
    .where(
      and(
        eq(userEpisodeProgress.userId, userId),
        eq(userEpisodeProgress.watched, true),
        eq(episodes.showId, showId),
        airedEpisodesFilter(),
      ),
    )

  const watched = watchedRow?.count ?? 0

  // Find the latest season (by season_number) that has at least one aired episode.
  const [latestSeasonRow] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(
      and(
        eq(seasons.showId, showId),
        sql`EXISTS (
          SELECT 1 FROM ${episodes}
          WHERE ${episodes.seasonId} = ${seasons.id}
            AND ${airedEpisodesFilter()}
        )`,
      ),
    )
    .orderBy(desc(seasons.seasonNumber))
    .limit(1)

  // Check whether the user has watched any aired episode in that latest season.
  let latestAiredSeasonUnwatched = false
  if (latestSeasonRow) {
    const [watchedInLatest] = await db
      .select({ count: count() })
      .from(userEpisodeProgress)
      .innerJoin(episodes, eq(userEpisodeProgress.episodeId, episodes.id))
      .where(
        and(
          eq(userEpisodeProgress.userId, userId),
          eq(userEpisodeProgress.watched, true),
          eq(episodes.seasonId, latestSeasonRow.id),
          airedEpisodesFilter(),
        ),
      )
    latestAiredSeasonUnwatched = (watchedInLatest?.count ?? 0) === 0
  }

  // hasActionable: there is a dated released episode the user hasn't watched.
  const [actionableRow] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .leftJoin(
      userEpisodeProgress,
      and(
        eq(userEpisodeProgress.episodeId, episodes.id),
        eq(userEpisodeProgress.userId, userId),
        eq(userEpisodeProgress.watched, true),
      ),
    )
    .where(
      and(
        eq(episodes.showId, showId),
        sql`${episodes.airDate} IS NOT NULL`,
        sql`${episodes.airDate} <= CURRENT_DATE`,
        sql`${userEpisodeProgress.episodeId} IS NULL`,
      ),
    )
    .limit(1)
  const hasActionable = actionableRow !== undefined

  // hasUpcoming: there is at least one episode the user can't watch yet —
  // either explicitly future-dated, or a NULL-air-date placeholder created by
  // enrichment (announced future season, no schedule). NULL eps with an
  // episode_providers row come from extension history-only ingest (Netflix)
  // and represent watched-but-undated, not upcoming.
  const [upcomingRow] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, showId),
        sql`(
          (${episodes.airDate} IS NOT NULL AND ${episodes.airDate} > CURRENT_DATE)
          OR (
            ${episodes.airDate} IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM ${episodeProviders}
              WHERE ${episodeProviders.episodeId} = ${episodes.id}
            )
          )
        )`,
      ),
    )
    .limit(1)
  const hasUpcoming = upcomingRow !== undefined

  // Get existing state
  const [existing] = await db
    .select()
    .from(userShowState)
    .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))

  if (!existing) return // Show not yet in user's library

  // Don't touch 'removed' status via this function
  if (existing.status === 'removed') {
    await db
      .update(userShowState)
      .set({ totalEpisodes: total, watchedEpisodes: watched, updatedAt: new Date() })
      .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))
    return
  }

  const { status: newStatus, queuePosition } = decideShowStatus({
    total,
    watched,
    latestAiredSeasonUnwatched,
    hasActionable,
    hasUpcoming,
    existingStatus: existing.status as ShowStatus,
    existingTotalEpisodes: existing.totalEpisodes,
    existingQueuePosition: existing.queuePosition,
  })

  await db
    .update(userShowState)
    .set({
      status: newStatus,
      totalEpisodes: total,
      watchedEpisodes: watched,
      queuePosition,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))
}
