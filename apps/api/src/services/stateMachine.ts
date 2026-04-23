import { eq, and, count } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import { userEpisodeProgress, userShowState, episodes, type showStatusEnum } from '@kyomiru/db/schema'

type ShowStatus = typeof showStatusEnum.enumValues[number]

export interface StatusInput {
  total: number
  watched: number
  existingStatus: ShowStatus
  existingTotalEpisodes: number
  existingQueuePosition: number | null
}

export interface StatusResult {
  status: ShowStatus
  queuePosition: number | null
}

export function decideShowStatus(input: StatusInput): StatusResult {
  const { total, watched, existingStatus, existingTotalEpisodes, existingQueuePosition } = input

  let status: ShowStatus

  if (total > 0 && watched === total) {
    status = 'watched'
  } else if (existingStatus === 'watched' && total > existingTotalEpisodes && watched < total) {
    status = 'new_content'
  } else if (existingStatus === 'new_content' && watched < total) {
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
  // Count total episodes for this show
  const [totalRow] = await db
    .select({ count: count() })
    .from(episodes)
    .where(eq(episodes.showId, showId))

  const total = totalRow?.count ?? 0

  // Count episodes watched by this user
  const [watchedRow] = await db
    .select({ count: count() })
    .from(userEpisodeProgress)
    .innerJoin(episodes, eq(userEpisodeProgress.episodeId, episodes.id))
    .where(
      and(
        eq(userEpisodeProgress.userId, userId),
        eq(userEpisodeProgress.watched, true),
        eq(episodes.showId, showId),
      ),
    )

  const watched = watchedRow?.count ?? 0

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
