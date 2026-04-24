import type { FastifyInstance } from 'fastify'
import { eq, and, desc, asc, count, sql } from 'drizzle-orm'
import { shows, showProviders, providers, userShowState, episodes, userEpisodeProgress, users } from '@kyomiru/db/schema'
import { LibraryQuerySchema } from '@kyomiru/shared/contracts/library'
import { loadShowProviderLinks } from '../services/providerLinks.js'
import { pickLocalized, resolveRequestLocales } from '../util/locale.js'

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/library', { preHandler: app.requireAuth }, async (req, reply) => {
    const userId = req.session.get('userId')!
    const { q, status, sort, provider, kind, limit } = LibraryQuerySchema.parse(req.query)

    // Resolve locale preference: saved setting > Accept-Language > en-US.
    const [userRow] = await app.db
      .select({ preferredLocale: users.preferredLocale })
      .from(users)
      .where(eq(users.id, userId))
    const locales = resolveRequestLocales(
      req.headers['accept-language'] as string | undefined,
      userRow?.preferredLocale,
    )

    const conditions = [eq(userShowState.userId, userId)]
    if (status) conditions.push(eq(userShowState.status, status))
    // COALESCE(kind_override, kind) so user-set override wins over auto-classified kind.
    if (kind) conditions.push(sql`COALESCE(${userShowState.kindOverride}, ${shows.kind}) = ${kind}`)
    if (provider) conditions.push(sql`EXISTS (
      SELECT 1 FROM show_providers
      WHERE show_providers.show_id = ${shows.id}
        AND show_providers.provider_key = ${provider}
    )`)
    // FTS via the tsvector maintained by the shows_search_tsv_update trigger.
    // Covers all locale values in shows.titles / shows.descriptions, and uses
    // the existing shows_search_tsv_idx GIN index — unlike the previous ilike
    // which was unindexed and English-only.
    if (q) conditions.push(sql`${shows.searchTsv} @@ websearch_to_tsquery('simple', ${q})`)

    const lastWatchedSql = sql`(
      SELECT MAX(uep.watched_at)
      FROM ${userEpisodeProgress} uep
      INNER JOIN ${episodes} ep ON ep.id = uep.episode_id
      WHERE uep.user_id = ${userId}
        AND ep.show_id = ${shows.id}
    )`

    // TODO(perf): title_asc, latest_air_date, rating, last_watched are
    // unindexed today — the planner runs a sort-in-memory after the
    // (user_id)-filtered join. Fine for realistic libraries; if this ever
    // gets slow, either add single-column indexes on the shows columns or
    // denormalise `effective_rating` onto user_show_state.
    const orderMap = {
      recent_activity: desc(userShowState.lastActivityAt),
      title_asc: asc(shows.canonicalTitle),
      // Fall back to TMDB/AniList rating (0-10 → /2) when the user hasn't rated,
      // so unrated shows still get an ordering position.
      rating: sql`COALESCE(${userShowState.rating}, ROUND(${shows.rating} / 2)) DESC NULLS LAST`,
      last_watched: sql`${lastWatchedSql} DESC NULLS LAST`,
      latest_air_date: desc(shows.latestAirDate),
      queue_position: sql`${userShowState.queuePosition} ASC NULLS LAST`,
    }

    const orderBy = orderMap[sort as keyof typeof orderMap] ?? desc(userShowState.lastActivityAt)

    const selectedCols = {
      id: shows.id,
      canonicalTitle: shows.canonicalTitle,
      titles: shows.titles,
      coverUrl: shows.coverUrl,
      year: shows.year,
      kind: shows.kind,
      kindOverride: userShowState.kindOverride,
      genres: shows.genres,
      latestAirDate: shows.latestAirDate,
      status: userShowState.status,
      rating: userShowState.rating,
      communityRating: shows.rating,
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
        canonicalTitle: pickLocalized(item.titles as Record<string, string>, locales, item.canonicalTitle),
        // Expose the effective kind (override wins in UI; both needed for controls).
        kind: item.kindOverride ?? item.kind,
        // Drizzle returns Postgres numeric as a string — coerce for the JSON contract.
        communityRating: item.communityRating !== null ? Number(item.communityRating) : null,
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
