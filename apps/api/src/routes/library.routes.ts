import type { FastifyInstance } from 'fastify'
import { eq, and, desc, asc, ilike, count } from 'drizzle-orm'
import { shows, userShowState } from '@kyomiru/db/schema'

export async function libraryRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      q?: string; status?: string; sort?: string; group?: string
      cursor?: string; limit?: string
    }
  }>('/library', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const { q, status, sort = 'recent_activity', cursor: _cursor, limit: limitStr = '48' } = req.query
    const limit = Math.min(parseInt(limitStr, 10) || 48, 100)

    const conditions = [eq(userShowState.userId, userId)]
    if (status) conditions.push(eq(userShowState.status, status as 'in_progress' | 'new_content' | 'watched' | 'removed'))

    const baseQuery = app.db
      .select({
        id: shows.id,
        canonicalTitle: shows.canonicalTitle,
        coverUrl: shows.coverUrl,
        year: shows.year,
        kind: shows.kind,
        genres: shows.genres,
        latestAirDate: shows.latestAirDate,
        status: userShowState.status,
        rating: userShowState.rating,
        favoritedAt: userShowState.favoritedAt,
        queuePosition: userShowState.queuePosition,
        totalEpisodes: userShowState.totalEpisodes,
        watchedEpisodes: userShowState.watchedEpisodes,
        lastActivityAt: userShowState.lastActivityAt,
      })
      .from(userShowState)
      .innerJoin(shows, eq(userShowState.showId, shows.id))
      .where(and(...conditions))

    const orderMap = {
      recent_activity: desc(userShowState.lastActivityAt),
      title_asc: asc(shows.canonicalTitle),
      rating: desc(userShowState.rating),
      updated_date: desc(shows.latestAirDate),
    }

    const orderBy = orderMap[sort as keyof typeof orderMap] ?? desc(userShowState.lastActivityAt)

    let items = await baseQuery.orderBy(orderBy).limit(limit + 1)

    // FTS if q provided
    if (q) {
      items = await app.db
        .select({
          id: shows.id,
          canonicalTitle: shows.canonicalTitle,
          coverUrl: shows.coverUrl,
          year: shows.year,
          kind: shows.kind,
          genres: shows.genres,
          latestAirDate: shows.latestAirDate,
          status: userShowState.status,
          rating: userShowState.rating,
          favoritedAt: userShowState.favoritedAt,
          queuePosition: userShowState.queuePosition,
          totalEpisodes: userShowState.totalEpisodes,
          watchedEpisodes: userShowState.watchedEpisodes,
          lastActivityAt: userShowState.lastActivityAt,
        })
        .from(userShowState)
        .innerJoin(shows, eq(userShowState.showId, shows.id))
        .where(and(...conditions, ilike(shows.canonicalTitle, `%${q}%`)))
        .orderBy(orderBy)
        .limit(limit + 1)
    }

    const hasMore = items.length > limit
    if (hasMore) items.pop()

    const [totalRow] = await app.db
      .select({ count: count() })
      .from(userShowState)
      .where(and(...conditions))

    reply.send({
      items: items.map((item) => ({
        ...item,
        latestAirDate: item.latestAirDate?.toString() ?? null,
        favoritedAt: item.favoritedAt?.toISOString() ?? null,
        lastActivityAt: item.lastActivityAt.toISOString(),
        providerKeys: [],
      })),
      pageInfo: {
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
        total: totalRow?.count ?? 0,
      },
    })
  })
}
