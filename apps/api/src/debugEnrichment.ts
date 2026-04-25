import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { eq, ne, and, sql } from 'drizzle-orm'
import { shows, seasons, episodes, userShowState, showProviders } from '@kyomiru/db/schema'
import { searchTMDb, fetchTMDbShowTree } from '@kyomiru/providers/enrichment/tmdb'
import { searchAniList, aniListTreeToSeasons } from '@kyomiru/providers/enrichment/anilist'
import { classifyKind } from './services/classifyKind.js'
import { upsertShowCatalog } from './services/sync.service.js'
import { recomputeUserShowState } from './services/stateMachine.js'
import { validateEnv } from './plugins/env.js'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const ANILIST_URL = 'https://graphql.anilist.co'
const CONFIDENCE_THRESHOLD = 0.8
const ANIME_PROMOTION_THRESHOLD = 0.9
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function hr(label: string) {
  const width = 64
  const inner = ` ${label} `
  const pad = Math.max(0, Math.floor((width - inner.length) / 2))
  console.log(`${'─'.repeat(pad)}${inner}${'─'.repeat(width - pad - inner.length)}`)
}

function redactKey(url: string): string {
  return url.replace(/api_key=[^&]+/, 'api_key=REDACTED')
}

// Mirrors packages/providers/src/enrichment/tmdb.ts (not exported from providers)
function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const matchDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  if (matchDist < 0) return 0
  const s1Matches = new Array<boolean>(s1.length).fill(false)
  const s2Matches = new Array<boolean>(s2.length).fill(false)
  let matches = 0, transpositions = 0
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDist)
    const end = Math.min(i + matchDist + 1, s2.length)
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = s2Matches[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

async function main() {
  const args = process.argv.slice(2)
  const showId = args.find((a) => !a.startsWith('--'))
  const apply = args.includes('--apply')

  if (!showId) {
    console.error('Usage: enrichment:debug <showId> [--apply]')
    process.exit(1)
  }

  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const locales = config.ENRICHMENT_LOCALES
  const tmdbKey = config.TMDB_API_KEY

  // ── Section 1: Current DB state ─────────────────────────────────────────────
  hr('Current DB state')

  const [show] = await db.select().from(shows).where(eq(shows.id, showId))
  if (!show) {
    console.error(`Show not found: ${showId}`)
    process.exit(1)
  }

  const scRows = await db
    .select({ sc: sql<number>`count(*)::int` })
    .from(seasons)
    .where(eq(seasons.showId, showId))
  const sc = scRows[0]?.sc ?? 0

  const ecRows = await db
    .select({ ec: sql<number>`count(*)::int` })
    .from(episodes)
    .where(eq(episodes.showId, showId))
  const ec = ecRows[0]?.ec ?? 0

  const providerLinks = await db
    .select({ providerKey: showProviders.providerKey, externalId: showProviders.externalId })
    .from(showProviders)
    .where(eq(showProviders.showId, showId))

  const titlesMap = (show.titles ?? {}) as Record<string, string>
  const descsMap = (show.descriptions ?? {}) as Record<string, string>
  const titlesKeys = Object.keys(titlesMap)
  const descsKeys = Object.keys(descsMap)

  const ageMs = show.enrichedAt ? Date.now() - show.enrichedAt.getTime() : null
  const ageStr = ageMs !== null
    ? `${Math.floor(ageMs / (1000 * 60 * 60 * 24))}d ago (${show.enrichedAt!.toISOString()})`
    : 'never enriched'
  const wouldSkip = ageMs !== null && ageMs < SEVEN_DAYS_MS

  console.log(`id              : ${show.id}`)
  console.log(`canonicalTitle  : "${show.canonicalTitle}"`)
  console.log(`kind            : ${show.kind}`)
  console.log(`year            : ${show.year ?? '(not set)'}`)
  console.log(`tmdbId          : ${show.tmdbId ?? '(not set)'}`)
  console.log(`anilistId       : ${show.anilistId ?? '(not set)'}`)
  console.log(`enrichedAt      : ${ageStr}`)
  console.log(`enrichAttempts  : ${show.enrichmentAttempts}`)
  console.log(`titles locales  : [${titlesKeys.join(', ')}]${titlesMap['en'] ? ` — en: "${titlesMap['en']}"` : ''}`)
  console.log(`desc locales    : [${descsKeys.join(', ')}]`)
  console.log(`genres          : ${show.genres.length ? show.genres.join(', ') : '(none)'}`)
  console.log(`latestAirDate   : ${show.latestAirDate ?? '(not set)'}`)
  console.log(`rating          : ${show.rating ?? '(not set)'}`)
  console.log(`coverUrl        : ${show.coverUrl ? 'set' : '(not set)'}`)
  console.log(`seasons / eps   : ${sc} seasons, ${ec} episodes`)

  if (providerLinks.length > 0) {
    for (const pl of providerLinks) {
      console.log(`provider link   : ${pl.providerKey} → externalId=${pl.externalId}`)
    }
  } else {
    console.log(`provider links  : (none)`)
  }

  console.log(`freshness       : ${wouldSkip ? '⚠ would be SKIPPED by worker (enriched <7d ago)' : 'would be re-enriched by worker'}`)
  console.log(`locales in use  : ${locales.join(', ')}`)
  console.log(`TMDB_API_KEY    : ${tmdbKey ? 'set' : '⚠ NOT SET — TMDb steps will be skipped'}`)

  // ── Section 2: Enrichment pipeline ──────────────────────────────────────────
  hr('Enrichment pipeline')
  console.log(`(dry run${apply ? '' : ' — no writes unless --apply is passed'})\n`)

  let tmdbMatch: Awaited<ReturnType<typeof searchTMDb>> = null
  let tmdbTree: Awaited<ReturnType<typeof fetchTMDbShowTree>> = null

  // Step 1 — TMDb search -------------------------------------------------------
  console.log('[Step 1] TMDb search')

  if (!tmdbKey) {
    console.log('  SKIPPED: TMDB_API_KEY not set')
  } else {
    console.log(`  query: "${show.canonicalTitle}"${show.year ? ` year=${show.year}` : ''}`)

    // Call the provider first (may silently swallow the error)
    tmdbMatch = await searchTMDb(show.canonicalTitle, tmdbKey, show.year ?? undefined)

    // Raw diagnostic fetch to expose the actual HTTP response
    const params = new URLSearchParams({ api_key: tmdbKey, query: show.canonicalTitle })
    if (show.year) params.set('first_air_date_year', String(show.year))
    const searchUrl = `${TMDB_BASE}/search/tv?${params}`
    console.log(`  raw fetch: ${redactKey(searchUrl)}`)

    try {
      const resp = await fetch(searchUrl)
      console.log(`  HTTP status: ${resp.status}`)
      if (!resp.ok) {
        const body = await resp.text()
        console.log(`  response body: ${body}`)
        console.log(`  → PROVIDER RESULT: null (HTTP error)`)
      } else {
        const json = await resp.json() as {
          results?: Array<{ id: number; name: string; first_air_date?: string }>
        }
        const results = json.results ?? []
        if (results.length === 0) {
          console.log(`  → 0 results returned by TMDb`)
          console.log(`  → PROVIDER RESULT: null (no results)`)
        } else {
          const t = show.canonicalTitle.toLowerCase()
          console.log(`  top ${Math.min(results.length, 5)} candidates (threshold ≥ ${CONFIDENCE_THRESHOLD}):`)
          for (const r of results.slice(0, 5)) {
            const conf = jaroWinkler(t, r.name.toLowerCase())
            const mark = conf >= CONFIDENCE_THRESHOLD ? '✓' : '✗'
            console.log(`    ${mark} id=${r.id}  "${r.name}"  (${r.first_air_date ?? 'no date'})  conf=${conf.toFixed(3)}`)
          }
          if (tmdbMatch) {
            console.log(`  → PROVIDER RESULT: matched id=${tmdbMatch.id} "${tmdbMatch.title}" conf=${tmdbMatch.confidence.toFixed(3)}`)
          } else {
            const bestConf = results.slice(0, 5).reduce((b, r) => Math.max(b, jaroWinkler(t, r.name.toLowerCase())), 0)
            console.log(`  → PROVIDER RESULT: null (best confidence ${bestConf.toFixed(3)} < ${CONFIDENCE_THRESHOLD} threshold)`)
          }
        }
      }
    } catch (err) {
      console.log(`  NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`)
      console.log(`  → PROVIDER RESULT: null (network error)`)
    }
  }

  // Step 2 — TMDb show tree ----------------------------------------------------
  console.log('\n[Step 2] TMDb show tree')

  if (!tmdbKey) {
    console.log('  SKIPPED: TMDB_API_KEY not set')
  } else if (!tmdbMatch) {
    console.log('  SKIPPED: no TMDb match from Step 1')
  } else {
    const primaryLocale = locales[0] ?? 'en-US'
    const treeUrl = `${TMDB_BASE}/tv/${tmdbMatch.id}?api_key=${tmdbKey}&language=${primaryLocale}&append_to_response=translations`
    console.log(`  fetch: ${redactKey(treeUrl)}`)
    console.log(`  locales: ${locales.join(', ')}`)

    const t0 = Date.now()
    tmdbTree = await fetchTMDbShowTree(tmdbMatch.id, tmdbKey, locales)
    const elapsed = Date.now() - t0

    if (!tmdbTree) {
      console.log(`  fetch returned null after ${elapsed}ms — attempting raw request for diagnosis`)
      try {
        const resp = await fetch(treeUrl)
        console.log(`  HTTP status: ${resp.status}`)
        const body = await resp.text()
        console.log(`  response body (first 500 chars): ${body.slice(0, 500)}`)
      } catch (err) {
        console.log(`  NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`)
      }
      console.log(`  → PROVIDER RESULT: null`)
    } else {
      console.log(`  fetched in ${elapsed}ms`)
      console.log(`  genres         : ${tmdbTree.genres.length ? tmdbTree.genres.join(', ') : '(none)'}`)
      console.log(`  originalLang   : ${tmdbTree.originalLanguage ?? '(not set)'}`)
      console.log(`  originCountry  : ${tmdbTree.originCountry?.join(', ') ?? '(not set)'}`)
      console.log(`  title locales  : [${Object.keys(tmdbTree.titles).join(', ')}]`)
      console.log(`  desc locales   : [${Object.keys(tmdbTree.descriptions).join(', ')}]`)
      console.log(`  seasons: ${tmdbTree.seasons.length}`)
      for (const s of tmdbTree.seasons) {
        const titled = s.episodes.filter((e) => e.title).length
        console.log(`    season ${s.number}: ${s.episodes.length} eps, ${titled} with title${s.airDate ? `, aired ${s.airDate}` : ''}`)
      }
      console.log(`  → PROVIDER RESULT: ok (${tmdbTree.seasons.length} seasons, ${tmdbTree.seasons.reduce((n, s) => n + s.episodes.length, 0)} episodes)`)

      // Carry resolved genres into tmdbMatch for classifyKind (mirrors worker line 115-117)
      tmdbMatch = { ...tmdbMatch, genres: tmdbTree.genres }
    }
  }

  // Step 3 — classifyKind first pass -------------------------------------------
  console.log('\n[Step 3] classifyKind (TMDb signals only)')

  const currentKind = show.kind as 'anime' | 'tv' | 'movie'
  const pass1Kind = classifyKind(currentKind, { tmdb: tmdbMatch })

  if (currentKind === 'movie') {
    console.log('  current=movie → movies are never reclassified')
  } else if (!tmdbMatch) {
    console.log(`  no TMDb match → kind unchanged`)
  } else if (tmdbMatch.genres.some((g) => g.toLowerCase().includes('anim'))) {
    console.log(`  TMDb genres include "anim": [${tmdbMatch.genres.join(', ')}]`)
  } else {
    console.log(`  TMDb genres (no "anim" match): [${tmdbMatch.genres.join(', ')}]`)
    console.log(`  originalLanguage=${tmdbTree?.originalLanguage ?? '?'}, originCountry=${tmdbTree?.originCountry?.join(',') ?? '?'}`)
  }
  console.log(`  → ${pass1Kind}`)

  // Step 4 — AniList search ----------------------------------------------------
  console.log('\n[Step 4] AniList search')

  let anilistMatch: Awaited<ReturnType<typeof searchAniList>> = null

  if (pass1Kind !== 'anime' && currentKind !== 'anime') {
    console.log(`  SKIPPED: kind=${pass1Kind}, show.kind=${currentKind} (AniList only queried for anime)`)
  } else {
    console.log(`  query: "${show.canonicalTitle}"`)

    // Compact query for diagnostic (we only need id, title, score for display)
    const diagQuery = `query($s:String){Media(search:$s,type:ANIME){id title{romaji english native}averageScore episodes startDate{year}}}`

    // Call the provider
    anilistMatch = await searchAniList(show.canonicalTitle, show.year ?? undefined)

    // Raw diagnostic fetch
    try {
      const resp = await fetch(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: diagQuery, variables: { s: show.canonicalTitle } }),
      })
      console.log(`  HTTP status: ${resp.status}`)
      if (!resp.ok) {
        const body = await resp.text()
        console.log(`  response body: ${body}`)
      } else {
        const json = await resp.json() as {
          data?: {
            Media?: {
              id: number
              title: { romaji?: string; english?: string; native?: string }
              averageScore?: number
              episodes?: number
              startDate?: { year?: number }
            }
          }
        }
        const media = json.data?.Media
        if (!media) {
          console.log(`  AniList returned data.Media = null (no result for this title)`)
        } else {
          console.log(`  AniList top result: id=${media.id}`)
          if (media.title.english) console.log(`    english  : "${media.title.english}"`)
          if (media.title.romaji)  console.log(`    romaji   : "${media.title.romaji}"`)
          if (media.title.native)  console.log(`    native   : "${media.title.native}"`)
          console.log(`    episodes : ${media.episodes ?? '?'}, year: ${media.startDate?.year ?? '?'}, avgScore: ${media.averageScore ?? '?'}`)

          const q = show.canonicalTitle.toLowerCase()
          const candidates = [media.title.english, media.title.romaji, media.title.native]
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
          const conf = candidates.reduce((b, c) => Math.max(b, jaroWinkler(q, c.toLowerCase())), 0)
          const bestCandidate = candidates.reduce(
            (b, c) => jaroWinkler(q, c.toLowerCase()) > jaroWinkler(q, b.toLowerCase()) ? c : b,
            candidates[0] ?? '',
          )
          const mark = conf >= CONFIDENCE_THRESHOLD ? '✓' : '✗'
          console.log(`    best match: "${bestCandidate}" conf=${conf.toFixed(3)} ${mark} (search threshold ≥ ${CONFIDENCE_THRESHOLD})`)
          if (conf >= CONFIDENCE_THRESHOLD && conf < ANIME_PROMOTION_THRESHOLD) {
            console.log(`    ⚠ above search threshold but below promotion threshold (${ANIME_PROMOTION_THRESHOLD}) — won't confirm anime on AniList confidence alone`)
          } else if (conf >= ANIME_PROMOTION_THRESHOLD) {
            console.log(`    ✓ above promotion threshold (${ANIME_PROMOTION_THRESHOLD}) — would confirm anime classification`)
          }
        }
      }
    } catch (err) {
      console.log(`  NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (anilistMatch) {
      console.log(`  → PROVIDER RESULT: matched id=${anilistMatch.id} "${anilistMatch.canonicalTitle}" conf=${anilistMatch.confidence.toFixed(3)}`)
      const tkeys = Object.keys(anilistMatch.titles)
      console.log(`    title locales: [${tkeys.join(', ')}]${anilistMatch.titles['en'] ? ` — en: "${anilistMatch.titles['en']}"` : ''}`)
      console.log(`    episodes: ${anilistMatch.episodes ?? '?'}, streamingEpisodes: ${anilistMatch.streamingEpisodeTitles.length}`)
    } else {
      console.log(`  → PROVIDER RESULT: null`)
    }
  }

  // Step 5 — classifyKind second pass ------------------------------------------
  console.log('\n[Step 5] classifyKind (TMDb + AniList signals)')

  const finalKind = classifyKind(pass1Kind, { tmdb: tmdbMatch, anilist: anilistMatch })

  if (pass1Kind === 'movie') {
    console.log('  movie → unchanged')
  } else if (anilistMatch && anilistMatch.confidence >= ANIME_PROMOTION_THRESHOLD) {
    console.log(`  AniList confidence ${anilistMatch.confidence.toFixed(3)} ≥ ${ANIME_PROMOTION_THRESHOLD} → anime`)
  } else if (tmdbMatch?.genres.some((g) => g.toLowerCase().includes('anim'))) {
    console.log(`  TMDb genres include "anim" → anime`)
  } else {
    console.log(`  no promotion signals → ${finalKind}`)
  }
  console.log(`  → ${finalKind}`)

  // Step 6 — Proposed merge ----------------------------------------------------
  console.log('\n[Step 6] Proposed merge')

  const matched = !!(tmdbMatch || anilistMatch)

  if (!matched) {
    console.log('  ✗ No match from either provider — nothing to write.')
    console.log(`    enrichmentAttempts: ${show.enrichmentAttempts} → ${show.enrichmentAttempts + 1}`)
    if (apply) {
      await db.update(shows)
        .set({ enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1 })
        .where(eq(shows.id, showId))
      console.log('  ✓ enrichmentAttempts incremented (--apply)')
    }
  } else {
    // Mirror the merge logic in enrichmentWorker.ts
    let mergedTitles: Record<string, string> = { ...titlesMap }
    let mergedDescs: Record<string, string> = { ...descsMap }

    if (tmdbTree) {
      mergedTitles = { ...mergedTitles, ...tmdbTree.titles }
      mergedDescs = { ...mergedDescs, ...tmdbTree.descriptions }
    }
    if (anilistMatch) {
      mergedTitles = { ...mergedTitles, ...anilistMatch.titles }
    }
    if (!mergedTitles['en'] && show.canonicalTitle) mergedTitles['en'] = show.canonicalTitle
    if (!mergedDescs['en'] && show.description) mergedDescs['en'] = show.description

    const newCanonicalTitle =
      anilistMatch?.canonicalTitle ??
      mergedTitles['en'] ??
      tmdbMatch?.title ??
      show.canonicalTitle

    const newDescription =
      mergedDescs['en'] ??
      anilistMatch?.description ??
      tmdbMatch?.description ??
      show.description ??
      null

    const genres =
      show.genres.length > 0
        ? show.genres
        : (tmdbTree?.genres.length ? tmdbTree.genres : (anilistMatch?.genres ?? []))

    const rating =
      anilistMatch?.rating !== undefined
        ? anilistMatch.rating
        : (tmdbTree?.rating ?? tmdbMatch?.rating ?? null)

    const coverUrl = show.coverUrl ?? anilistMatch?.coverUrl ?? tmdbMatch?.coverUrl ?? null
    const year = show.year ?? anilistMatch?.year ?? tmdbMatch?.year ?? null
    const tmdbId = show.tmdbId ?? tmdbMatch?.id ?? null
    const anilistId = show.anilistId ?? anilistMatch?.id ?? null

    let seasonTrees = tmdbTree?.seasons ?? []
    if (anilistMatch) {
      const anilistSeasons = aniListTreeToSeasons(anilistMatch)
      if (anilistSeasons.length > 0 && seasonTrees.length === 0) seasonTrees = anilistSeasons
    }

    function diff<T>(label: string, current: T, proposed: T): string {
      const changed = JSON.stringify(current) !== JSON.stringify(proposed)
      const tag = changed ? ' [CHANGED]' : ''
      return `  ${label.padEnd(18)}: ${JSON.stringify(proposed)}${tag}`
    }

    const ratingProposed = rating !== null && rating !== undefined ? rating.toFixed(1) : null
    console.log(diff('canonicalTitle', show.canonicalTitle, newCanonicalTitle))
    console.log(diff('kind', show.kind, finalKind))
    console.log(diff('tmdbId', show.tmdbId, tmdbId))
    console.log(diff('anilistId', show.anilistId, anilistId))
    console.log(diff('year', show.year, year))
    console.log(diff('genres', show.genres, genres))
    console.log(diff('rating', show.rating, ratingProposed))
    console.log(diff('coverUrl', show.coverUrl ? 'set' : null, coverUrl ? 'set' : null))
    console.log(diff('description', show.description?.slice(0, 50) ?? null, newDescription?.slice(0, 50) ?? null))
    console.log(diff('titles locales', Object.keys(titlesMap), Object.keys(mergedTitles)))
    console.log(diff('desc locales', Object.keys(descsMap), Object.keys(mergedDescs)))

    const totalNewEps = seasonTrees.reduce((n, s) => n + s.episodes.length, 0)
    console.log(`  ${'season tree'.padEnd(18)}: ${seasonTrees.length} season(s), ${totalNewEps} episode(s) total`)

    if (apply) {
      hr('Applying')

      await db.update(shows).set({
        canonicalTitle: newCanonicalTitle,
        titleNormalized: newCanonicalTitle.toLowerCase().replace(/[^\w\s]/g, ''),
        description: newDescription,
        coverUrl,
        genres,
        year,
        kind: finalKind,
        titles: mergedTitles,
        descriptions: mergedDescs,
        tmdbId,
        anilistId,
        rating: ratingProposed,
        enrichedAt: new Date(),
        enrichmentAttempts: (show.enrichmentAttempts ?? 0) + 1,
      }).where(eq(shows.id, showId))
      console.log('  ✓ show row updated')

      if (seasonTrees.length > 0) {
        await upsertShowCatalog(db, showId, null, seasonTrees)
        console.log(`  ✓ upserted ${seasonTrees.length} season(s), ${totalNewEps} episode(s)`)

        const [airDateRow] = await db
          .select({ latest: sql<string | null>`MAX(${episodes.airDate})` })
          .from(episodes)
          .where(eq(episodes.showId, showId))
        if (airDateRow?.latest) {
          await db.update(shows).set({ latestAirDate: airDateRow.latest }).where(eq(shows.id, showId))
          console.log(`  ✓ latestAirDate refreshed to ${airDateRow.latest}`)
        }
      }

      const libraryRows = await db
        .select({ userId: userShowState.userId })
        .from(userShowState)
        .where(and(eq(userShowState.showId, showId), ne(userShowState.status, 'removed')))

      for (const { userId } of libraryRows) {
        await recomputeUserShowState(db, userId, showId)
      }
      console.log(`  ✓ recomputed user_show_state for ${libraryRows.length} user(s)`)
      console.log(`\nDone. Applied enrichment for ${showId}.`)
    } else {
      console.log('\nDry run — no changes written. Re-run with --apply to persist.')
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
