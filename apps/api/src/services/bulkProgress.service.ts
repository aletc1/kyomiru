import { eq, and, sql } from 'drizzle-orm'
import type { DbClient } from '@kyomiru/db/client'
import { episodes, seasons, userEpisodeProgress } from '@kyomiru/db/schema'
import { recomputeUserShowState, airedEpisodesFilter } from './stateMachine.js'

export class SeasonNotFoundError extends Error {
  constructor() {
    super('Season not found')
    this.name = 'SeasonNotFoundError'
  }
}

export async function bulkUpdateEpisodeProgress(
  db: DbClient,
  userId: string,
  showId: string,
  opts: { watched: boolean; seasonId?: string | undefined },
): Promise<{ episodesUpdated: number }> {
  if (opts.seasonId) {
    const [season] = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.id, opts.seasonId), eq(seasons.showId, showId)))
    if (!season) throw new SeasonNotFoundError()
  }

  const now = new Date()
  let episodesUpdated = 0

  await db.transaction(async (tx) => {
    const episodeRows = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, showId),
          opts.seasonId ? eq(episodes.seasonId, opts.seasonId) : undefined,
          airedEpisodesFilter(),
        ),
      )

    if (episodeRows.length === 0) return

    const values = episodeRows.map((e) => ({
      userId,
      episodeId: e.id,
      playheadSeconds: 0,
      watched: opts.watched,
      watchedAt: opts.watched ? now : null,
      lastEventAt: now,
    }))

    await tx
      .insert(userEpisodeProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [userEpisodeProgress.userId, userEpisodeProgress.episodeId],
        set: {
          watched: opts.watched,
          watchedAt: opts.watched ? now : null,
          lastEventAt: now,
          playheadSeconds: sql`user_episode_progress.playhead_seconds`,
        },
      })

    episodesUpdated = episodeRows.length
  })

  await recomputeUserShowState(db, userId, showId)

  return { episodesUpdated }
}
