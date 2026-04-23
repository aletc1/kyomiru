import type { SeasonTree } from '../types.js'

const ANILIST_URL = 'https://graphql.anilist.co'

interface AniListMedia {
  id: number
  title: { romaji?: string; english?: string; native?: string }
  description?: string
  coverImage?: { large?: string; extraLarge?: string }
  genres?: string[]
  startDate?: { year?: number }
  status?: string
  episodes?: number
  averageScore?: number
  streamingEpisodes?: Array<{ title?: string; thumbnail?: string; url?: string }>
}

const MEDIA_QUERY = `
  query SearchAnime($search: String) {
    Media(search: $search, type: ANIME) {
      id
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      genres
      startDate { year }
      status
      episodes
      averageScore
      streamingEpisodes { title thumbnail url }
    }
  }
`

export interface AniListMatch {
  id: number
  title: string
  description?: string
  coverUrl?: string
  genres: string[]
  year?: number
  /** Normalized 0-10 scale (AniList returns 0-100). */
  rating?: number
  episodes?: number
  streamingEpisodeTitles: string[]
  confidence: number
}

export async function searchAniList(title: string, _year?: number): Promise<AniListMatch | null> {
  try {
    const resp = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: MEDIA_QUERY, variables: { search: title } }),
    })
    if (!resp.ok) {
      console.warn(`[anilist] HTTP ${resp.status} for "${title}"`)
      return null
    }
    const json = await resp.json() as { data?: { Media?: AniListMedia } }
    const media = json.data?.Media
    if (!media) return null

    // Score against all available titles — the Crunchyroll title may match the
    // native or romaji even when the AniList english differs significantly.
    const candidates = [media.title.english, media.title.romaji, media.title.native]
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
    const t = title.toLowerCase()
    const confidence = candidates.reduce(
      (best, c) => Math.max(best, jaroWinkler(t, c.toLowerCase())),
      0,
    )
    const resultTitle = media.title.english ?? media.title.romaji ?? media.title.native ?? ''
    if (confidence < 0.8) return null

    const desc = media.description?.replace(/<[^>]*>/g, '')
    const cover = media.coverImage?.extraLarge ?? media.coverImage?.large
    const yr = media.startDate?.year
    const rating = typeof media.averageScore === 'number' ? media.averageScore / 10 : undefined
    return {
      id: media.id,
      title: resultTitle,
      ...(desc && { description: desc }),
      ...(cover && { coverUrl: cover }),
      genres: media.genres ?? [],
      ...(yr && { year: yr }),
      ...(rating !== undefined && { rating }),
      ...(typeof media.episodes === 'number' && { episodes: media.episodes }),
      streamingEpisodeTitles: (media.streamingEpisodes ?? [])
        .map((e) => e.title ?? '')
        .filter((t) => t.length > 0),
      confidence,
    }
  } catch (err) {
    console.warn(`[anilist] search failed for "${title}":`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Synthesize a single-season tree from an AniList match.
 *
 * AniList has no per-season structure — only a flat episode count and an
 * optional `streamingEpisodes` list. We emit one season (number 1) with N
 * episodes and pull titles from `streamingEpisodes` by index when available.
 */
export function aniListTreeToSeasons(match: AniListMatch): SeasonTree[] {
  const count = Math.max(match.episodes ?? 0, match.streamingEpisodeTitles.length)
  if (count <= 0) return []
  return [{
    number: 1,
    episodes: Array.from({ length: count }, (_, idx) => {
      const epNumber = idx + 1
      const title = match.streamingEpisodeTitles[idx]
      return {
        number: epNumber,
        ...(title && { title }),
        externalId: '',
      }
    }),
  }]
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
