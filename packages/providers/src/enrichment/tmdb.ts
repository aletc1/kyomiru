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
}

interface TMDbShowDetail {
  id: number
  name: string
  overview?: string
  poster_path?: string
  genres?: Array<{ id: number; name: string }>
  first_air_date?: string
  vote_average?: number
  seasons?: Array<{
    id: number
    season_number: number
    name?: string
    air_date?: string | null
    episode_count?: number
  }>
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
      confidence,
    }
  } catch {
    return null
  }
}

/**
 * Fetch the full season/episode tree for a TMDb TV show.
 *
 * Returns null on error (network, 404, rate-limit) so the caller can fall
 * back to whatever partial data is already in the DB.
 */
export async function fetchTMDbShowTree(
  tmdbId: number,
  apiKey: string,
): Promise<{
  genres: string[]
  rating?: number
  seasons: SeasonTree[]
} | null> {
  if (!apiKey) return null
  try {
    const detailResp = await fetch(`${TMDB_BASE}/tv/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`)
    if (!detailResp.ok) return null
    const detail = (await detailResp.json()) as TMDbShowDetail

    const seasonTrees: SeasonTree[] = []

    // TMDb exposes season 0 for "specials" — skip it, it pollutes episode counts.
    const realSeasons = (detail.seasons ?? []).filter((s) => s.season_number > 0)

    for (const s of realSeasons) {
      const seasonResp = await fetch(
        `${TMDB_BASE}/tv/${tmdbId}/season/${s.season_number}?api_key=${encodeURIComponent(apiKey)}`,
      )
      if (!seasonResp.ok) continue
      const seasonDetail = (await seasonResp.json()) as TMDbSeasonDetail

      seasonTrees.push({
        number: s.season_number,
        ...(s.name && { title: s.name }),
        ...(s.air_date && { airDate: s.air_date }),
        episodes: (seasonDetail.episodes ?? []).map((e) => ({
          number: e.episode_number,
          ...(e.name && { title: e.name }),
          ...(typeof e.runtime === 'number' && e.runtime > 0 && { durationSeconds: e.runtime * 60 }),
          ...(e.air_date && { airDate: e.air_date }),
          // No streaming-provider external id — this is metadata-only.
          externalId: '',
        })),
      })
    }

    return {
      genres: (detail.genres ?? []).map((g) => g.name),
      ...(typeof detail.vote_average === 'number' && { rating: detail.vote_average }),
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
