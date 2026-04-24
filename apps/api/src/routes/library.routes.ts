import type { FastifyInstance } from 'fastify'
import { eq, and, desc, asc, ilike, count, sql } from 'drizzle-orm'
import { shows, showProviders, providers, userShowState, episodes, userEpisodeProgress } from '@kyomiru/db/schema'
import { LibraryQuerySchema } from '@kyomiru/shared/contracts/library'
import { loadShowProviderLinks } from '../services/providerLinks.js'

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/library', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const { q, status, sort, provider, kind, limit } = LibraryQuerySchema.parse(req.query)

    const conditions = [eq(userShowState.userId, userId)]
    if (status) conditions.push(eq(userShowState.status, status))
    if (kind) conditions.push(eq(shows.kind, kind))
    // `provider` is a free-form string from the client; the parameterised
    // EXISTS subquery is SQL-safe, and an unknown key simply matches nothing.
    if (provider) conditions.push(sql`EXISTS (
      SELECT 1 FROM show_providers
      WHERE show_providers.show_id = ${shows.id}
        AND show_providers.provider_key = ${provider}
    )`)
    if (q) conditions.push(ilike(shows.canonicalTitle, `%${q}%`))

    const lastWatchedSql = sql`(
      SELECT MAX(uep.watched_at)
      FROM ${userEpisodeProgress} uep
      INNER JOIN ${episodes} ep ON ep.id = uep.episode_id
      WHERE uep.user_id = ${userId}
        AND ep.show_id = ${shows.id}
    )`

    const orderMap = {
      recent_activity: desc(userShowState.lastActivityAt),
      title_asc: asc(shows.canonicalTitle),
      rating: desc(userShowState.rating),
      last_watched: sql`${lastWatchedSql} DESC NULLS LAST`,
      latest_air_date: desc(shows.latestAirDate),
    }

    const orderBy = orderMap[sort as keyof typeof orderMap] ?? desc(userShowState.lastActivityAt)

    const selectedCols = {
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
    }

    const rows = await app.db
      .select(selectedCols)
      .from(userShowState)
      .innerJoin(shows, eq(userShowState.showId, shows.id))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    if (hasMore) rows.pop()

    const [totalRow] = await app.db
      .select({ count: count() })
      .from(userShowState)
      .innerJoin(shows, eq(userShowState.showId, shows.id))
      .where(and(...conditions))

    const providerLinks = await loadShowProviderLinks(app.db, rows.map((i) => i.id))

    reply.send({
      items: rows.map((item) => ({
        ...item,
        latestAirDate: item.latestAirDate?.toString() ?? null,
        favoritedAt: item.favoritedAt?.toISOString() ?? null,
        lastActivityAt: item.lastActivityAt.toISOString(),
        providers: providerLinks.get(item.id) ?? [],
      })),
      pageInfo: {
        nextCursor: hasMore ? rows[rows.length - 1]?.id ?? null : null,
        total: totalRow?.count ?? 0,
      },
    })
  })

  app.get('/library/facets', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!

    const [providerRows, kindRows] = await Promise.all([
      app.db
        .selectDistinct({ key: providers.key, displayName: providers.displayName })
        .from(showProviders)
        .innerJoin(providers, eq(showProviders.providerKey, providers.key))
        .innerJoin(userShowState, eq(showProviders.showId, userShowState.showId))
        .where(and(eq(userShowState.userId, userId), eq(providers.enabled, true)))
        .orderBy(asc(providers.displayName)),
      app.db
        .selectDistinct({ kind: shows.kind })
        .from(shows)
        .innerJoin(userShowState, eq(shows.id, userShowState.showId))
        .where(eq(userShowState.userId, userId))
        .orderBy(asc(shows.kind)),
    ])

    reply.send({
      providers: providerRows,
      kinds: kindRows.map((r) => r.kind),
    })
  })
}
