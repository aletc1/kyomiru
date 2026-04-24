import type { SeasonTree } from '../types.js'

const TMDB_BASE = 'https://api.themoviedb.org/3'

export interface TMDbMatch {
  id: number
  title: string
  description?: string
  coverUrl?: string
  genres: string[]
  year?: number
  rating?: number
  originalLanguage?: string
  originCountry?: string[]
  confidence: number
}

interface TMDbSearchResult {
  id: number
  name: string
  overview?: string
  poster_path?: string
  genre_ids?: number[]
  first_air_date?: string
  vote_average?: number
  original_language?: string
  origin_country?: string[]
}

interface TMDbTranslation {
  iso_3166_1: string
  iso_639_1: string
  data: {
    name?: string
    overview?: string
  }
}

interface TMDbShowDetail {
  id: number
  name: string
  overview?: string
  poster_path?: string
  genres?: Array<{ id: number; name: string }>
  first_air_date?: string
  vote_average?: number
  original_language?: string
  origin_country?: string[]
  seasons?: Array<{
    id: number
    season_number: number
    name?: string
    air_date?: string | null
    episode_count?: number
  }>
  translations?: {
    translations: TMDbTranslation[]
  }
}

interface TMDbSeasonDetail {
  id: number
  season_number: number
  name?: string
  air_date?: string | null
  episodes?: Array<{
    id: number
    episode_number: number
    name?: string
    air_date?: string | null
    runtime?: number | null
  }>
}

export async function searchTMDb(title: string, apiKey: string, year?: number): Promise<TMDbMatch | null> {
  if (!apiKey) return null
  try {
    const params = new URLSearchParams({ api_key: apiKey, query: title })
    if (year) params.set('first_air_date_year', String(year))
    const resp = await fetch(`${TMDB_BASE}/search/tv?${params}`)
    if (!resp.ok) return null
    const json = await resp.json() as { results?: TMDbSearchResult[] }
    const result = json.results?.[0]
    if (!result) return null

    const confidence = jaroWinkler(title.toLowerCase(), result.name.toLowerCase())
    if (confidence < 0.8) return null

    const yr = result.first_air_date ? parseInt(result.first_air_date.slice(0, 4), 10) : undefined
    return {
      id: result.id,
      title: result.name,
      ...(result.overview && { description: result.overview }),
      ...(result.poster_path && { coverUrl: `https://image.tmdb.org/t/p/w500${result.poster_path}` }),
      genres: [],
      ...(yr && { year: yr }),
      ...(typeof result.vote_average === 'number' && { rating: result.vote_average }),
      ...(result.original_language && { originalLanguage: result.original_language }),
      ...(result.origin_country?.length && { originCountry: result.origin_country }),
      confidence,
    }
  } catch {
    return null
  }
}

/**
 * Fetch the full season/episode tree for a TMDb TV show, in all requested locales.
 *
 * Show-level translations come from `append_to_response=translations` (one round
 * trip). Episode titles are fetched per-locale per-season sequentially to stay
 * within TMDB rate limits.
 *
 * Returns null on error so the caller can fall back to existing DB data.
 */
export async function fetchTMDbShowTree(
  tmdbId: number,
  apiKey: string,
  locales: string[] = ['en-US'],
): Promise<{
  titles: Record<string, string>
  descriptions: Record<string, string>
  genres: string[]
  rating?: number
  originalLanguage?: string
  originCountry?: string[]
  seasons: SeasonTree[]
} | null> {
  if (!apiKey) return null
  try {
    const primaryLocale = locales[0] ?? 'en-US'
    const detailResp = await fetch(
      `${TMDB_BASE}/tv/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(primaryLocale)}&append_to_response=translations`,
    )
    if (!detailResp.ok) return null
    const detail = (await detailResp.json()) as TMDbShowDetail

    // Build locale maps keyed by base language (en, ja, es, fr). Matches
    // how episodes are keyed below and avoids duplicates like {en, 'en-US'}.
    const titles: Record<string, string> = {}
    const descriptions: Record<string, string> = {}

    const primaryBase = primaryLocale.split('-')[0] ?? primaryLocale
    if (detail.name) titles[primaryBase] = detail.name
    if (detail.overview) descriptions[primaryBase] = detail.overview

    for (const t of detail.translations?.translations ?? []) {
      const lang = t.iso_639_1
      if (!lang) continue
      if (t.data.name && !titles[lang]) titles[lang] = t.data.name
      if (t.data.overview && !descriptions[lang]) descriptions[lang] = t.data.overview
    }

    const seasonTrees: SeasonTree[] = []
    const realSeasons = (detail.seasons ?? []).filter((s) => s.season_number > 0)

    for (const s of realSeasons) {
      // Fetch the primary-locale season for structure (episode list, runtime, air dates).
      const primarySeasonResp = await fetch(
        `${TMDB_BASE}/tv/${tmdbId}/season/${s.season_number}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(primaryLocale)}`,
      )
      if (!primarySeasonResp.ok) continue
      const primarySeason = (await primarySeasonResp.json()) as TMDbSeasonDetail

      // Map episode number → locale-keyed titles.
      const epTitlesMap = new Map<number, Record<string, string>>()
      const epDescriptionsMap = new Map<number, Record<string, string>>()
      for (const e of primarySeason.episodes ?? []) {
        const langKey = primaryLocale.split('-')[0] ?? primaryLocale
        if (e.name) epTitlesMap.set(e.episode_number, { [langKey]: e.name })
        epDescriptionsMap.set(e.episode_number, {})
      }

      // Fetch additional locales for episode titles.
      const additionalLocales = locales.slice(1)
      for (const locale of additionalLocales) {
        const langKey = locale.split('-')[0] ?? locale
        const localeResp = await fetch(
          `${TMDB_BASE}/tv/${tmdbId}/season/${s.season_number}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(locale)}`,
        )
        if (!localeResp.ok) continue
        const localeSeason = (await localeResp.json()) as TMDbSeasonDetail
        for (const e of localeSeason.episodes ?? []) {
          if (e.name) {
            const existing = epTitlesMap.get(e.episode_number) ?? {}
            epTitlesMap.set(e.episode_number, { ...existing, [langKey]: e.name })
          }
        }
      }

      const seasonLangKey = primaryLocale.split('-')[0] ?? primaryLocale
      seasonTrees.push({
        number: s.season_number,
        ...(s.name && { title: s.name, titles: { [seasonLangKey]: s.name } }),
        ...(s.air_date && { airDate: s.air_date }),
        episodes: (primarySeason.episodes ?? []).map((e) => ({
          number: e.episode_number,
          ...(e.name && { title: e.name }),
          titles: epTitlesMap.get(e.episode_number) ?? {},
          descriptions: epDescriptionsMap.get(e.episode_number) ?? {},
          ...(typeof e.runtime === 'number' && e.runtime > 0 && { durationSeconds: e.runtime * 60 }),
          ...(e.air_date && { airDate: e.air_date }),
          externalId: '',
        })),
      })
    }

    return {
      titles,
      descriptions,
      genres: (detail.genres ?? []).map((g) => g.name),
      ...(typeof detail.vote_average === 'number' && { rating: detail.vote_average }),
      ...(detail.original_language && { originalLanguage: detail.original_language }),
      ...(detail.origin_country?.length && { originCountry: detail.origin_country }),
      seasons: seasonTrees,
    }
  } catch {
    return null
  }
}

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const matchDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  if (matchDist < 0) return 0
  const s1Matches = new Array<boolean>(s1.length).fill(false)
  const s2Matches = new Array<boolean>(s2.length).fill(false)
  let matches = 0
  let transpositions = 0
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDist)
    const end = Math.min(i + matchDist + 1, s2.length)
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
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
