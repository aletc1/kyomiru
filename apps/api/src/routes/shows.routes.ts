import type { FastifyInstance } from 'fastify'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { shows, userShowState, seasons, episodes, userEpisodeProgress, users } from '@kyomiru/db/schema'
import { PatchShowBodySchema, PatchEpisodeBodySchema } from '@kyomiru/shared/contracts/shows'
import { recomputeUserShowState } from '../services/stateMachine.js'
import { enqueueEnrichment } from '../workers/enrichmentWorker.js'
import { loadShowProviderLinks, loadEpisodeProviderLinks } from '../services/providerLinks.js'
import { pickLocalized, resolveRequestLocales } from '../util/locale.js'

export async function showsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/shows/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { id } = req.params

      const [show] = await app.db.select().from(shows).where(eq(shows.id, id))
      if (!show) return reply.status(404).send({ error: 'Show not found' })

      if (!show.enrichedAt) {
        await enqueueEnrichment(app.enrichmentQueue, id)
        req.log.info({ showId: id }, 'Enqueued enrichment from shows.get (unenriched)')
      }

      const [userRow] = await app.db
        .select({ preferredLocale: users.preferredLocale })
        .from(users)
        .where(eq(users.id, userId))
      const locales = resolveRequestLocales(
        req.headers['accept-language'] as string | undefined,
        userRow?.preferredLocale,
      )

      const [state] = await app.db
        .select()
        .from(userShowState)
        .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, id)))

      const allSeasons = await app.db
        .select()
        .from(seasons)
        .where(eq(seasons.showId, id))
        .orderBy(seasons.seasonNumber)

      const seasonsWithEps = await Promise.all(
        allSeasons.map(async (s) => {
          const eps = await app.db
            .select()
            .from(episodes)
            .where(eq(episodes.seasonId, s.id))
            .orderBy(episodes.episodeNumber)

          const progress = eps.length === 0
            ? []
            : await app.db
                .select()
                .from(userEpisodeProgress)
                .where(
                  and(
                    eq(userEpisodeProgress.userId, userId),
                    inArray(userEpisodeProgress.episodeId, eps.map((e) => e.id)),
                  ),
                )

          return { season: s, eps, progress }
        }),
      )

      const allEpisodeIds = seasonsWithEps.flatMap((row) => row.eps.map((e) => e.id))
      const [showProviderMap, episodeProviderMap] = await Promise.all([
        loadShowProviderLinks(app.db, [show.id]),
        loadEpisodeProviderLinks(app.db, allEpisodeIds),
      ])

      const seasonDetails = seasonsWithEps.map(({ season: s, eps, progress }) => {
        const progressMap = new Map(progress.map((p) => [p.episodeId, p]))
        const watchedCount = progress.filter((p) => p.watched).length

        return {
          id: s.id,
          seasonNumber: s.seasonNumber,
          title: pickLocalized(s.titles as Record<string, string>, locales, s.title),
          airDate: s.airDate?.toString() ?? null,
          episodeCount: eps.length,
          watchedCount,
          episodes: eps.map((e) => {
            const p = progressMap.get(e.id)
            return {
              id: e.id,
              episodeNumber: e.episodeNumber,
              title: pickLocalized(e.titles as Record<string, string>, locales, e.title),
              durationSeconds: e.durationSeconds,
              airDate: e.airDate?.toString() ?? null,
              watched: p?.watched ?? false,
              watchedAt: p?.watchedAt?.toISOString() ?? null,
              playheadSeconds: p?.playheadSeconds ?? 0,
              providers: episodeProviderMap.get(e.id) ?? [],
            }
          }),
        }
      })

      const showTitles = show.titles as Record<string, string>
      const showDescriptions = show.descriptions as Record<string, string>

      reply.send({
        id: show.id,
        canonicalTitle: pickLocalized(showTitles, locales, show.canonicalTitle),
        description: pickLocalized(showDescriptions, locales, show.description),
        coverUrl: show.coverUrl,
        year: show.year,
        kind: state?.kindOverride ?? show.kind,
        kindOverride: state?.kindOverride ?? null,
        genres: show.genres,
        latestAirDate: show.latestAirDate?.toString() ?? null,
        status: state?.status ?? null,
        rating: state?.rating ?? null,
        communityRating: show.rating !== null ? Number(show.rating) : null,
        favoritedAt: state?.favoritedAt?.toISOString() ?? null,
        queuePosition: state?.queuePosition ?? null,
        totalEpisodes: state?.totalEpisodes ?? 0,
        watchedEpisodes: state?.watchedEpisodes ?? 0,
        lastActivityAt: state?.lastActivityAt?.toISOString() ?? new Date().toISOString(),
        providers: showProviderMap.get(show.id) ?? [],
        seasons: seasonDetails,
      })
    },
  )

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/shows/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { id: showId } = req.params
      const body = PatchShowBodySchema.parse(req.body)

      const [existing] = await app.db
        .select()
        .from(userShowState)
        .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))

      if (!existing) return reply.status(404).send({ error: 'Show not in library' })

      const updates: Partial<typeof userShowState.$inferInsert> = { updatedAt: new Date() }

      if (body.rating !== undefined) updates.rating = body.rating

      if (body.status === 'removed') {
        updates.status = 'removed'
        updates.prevStatus = existing.status
        updates.queuePosition = null
      } else if (body.status === 'restore') {
        updates.status = existing.prevStatus ?? 'in_progress'
        updates.prevStatus = null
      }

      if ('kindOverride' in body) updates.kindOverride = body.kindOverride ?? null

      if (body.favorited === true && !existing.favoritedAt) {
        const maxQueuePos = await app.db
          .select({ max: userShowState.queuePosition })
          .from(userShowState)
          .where(eq(userShowState.userId, userId))
          .then((rows) => Math.max(0, ...rows.map((r) => r.max ?? 0)))

        updates.favoritedAt = new Date()
        updates.queuePosition = maxQueuePos + 1
      } else if (body.favorited === false) {
        updates.favoritedAt = null
        updates.queuePosition = null
      }

      await app.db
        .update(userShowState)
        .set(updates)
        .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))

      await recomputeUserShowState(app.db, userId, showId)
      reply.send({ ok: true })
    },
  )

  app.patch<{ Params: { showId: string; episodeId: string }; Body: unknown }>(
    '/shows/:showId/episodes/:episodeId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const userId = req.session.get('userId')!
      const { showId, episodeId } = req.params
      const body = PatchEpisodeBodySchema.parse(req.body)

      const [episode] = await app.db
        .select({ id: episodes.id, showId: episodes.showId })
        .from(episodes)
        .where(eq(episodes.id, episodeId))

      if (!episode || episode.showId !== showId) {
        return reply.status(404).send({ error: 'Episode not found' })
      }

      const [existingShow] = await app.db
        .select({ showId: userShowState.showId })
        .from(userShowState)
        .where(and(eq(userShowState.userId, userId), eq(userShowState.showId, showId)))

      if (!existingShow) return reply.status(404).send({ error: 'Show not in library' })

      const now = new Date()
      await app.db.insert(userEpisodeProgress).values({
        userId,
        episodeId,
        playheadSeconds: 0,
        watched: body.watched,
        watchedAt: body.watched ? now : null,
        lastEventAt: now,
      }).onConflictDoUpdate({
        target: [userEpisodeProgress.userId, userEpisodeProgress.episodeId],
        set: {
          watched: body.watched,
          watchedAt: body.watched ? now : null,
          lastEventAt: now,
          playheadSeconds: sql`user_episode_progress.playhead_seconds`,
        },
      })

      await recomputeUserShowState(app.db, userId, showId)
      reply.send({ ok: true })
    },
  )
}
