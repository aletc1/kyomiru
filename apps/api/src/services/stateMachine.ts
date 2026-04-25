import { eq, and, count, sql, desc } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import { userEpisodeProgress, userShowState, episodes, seasons, type showStatusEnum } from '@kyomiru/db/schema'

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
  existingStatus: ShowStatus
  existingTotalEpisodes: number
  existingQueuePosition: number | null
}

export interface StatusResult {
  status: ShowStatus
  queuePosition: number | null
}

export function decideShowStatus(input: StatusInput): StatusResult {
  const { total, watched, latestAiredSeasonUnwatched, existingStatus, existingTotalEpisodes, existingQueuePosition } = input

  let status: ShowStatus

  if (total > 0 && watched === total) {
    status = 'watched'
  } else if (existingStatus === 'watched' && total > existingTotalEpisodes && watched < total) {
    status = 'new_content'
  } else if (existingStatus === 'new_content' && watched < total) {
    status = 'new_content'
  } else if (watched > 0 && watched < total && latestAiredSeasonUnwatched) {
    // User has started the show but the latest aired season is completely unwatched.
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
