import type { TMDbMatch } from '@kyomiru/providers/enrichment/tmdb'
import type { AniListMatch } from '@kyomiru/providers/enrichment/anilist'

/**
 * Derive the canonical show kind from enrichment signals.
 *
 * Rules:
 *  1. Movies are never reclassified (enrichment doesn't change movie→tv).
 *  2. A high-confidence AniList match (≥ 0.9) is definitive — AniList only
 *     contains anime, so matching there means it's anime.
 *  3. If TMDB reports any genre containing "anim" (Animation, Anime,
 *     Animated, …), the show is animated content and we classify it as
 *     anime. Kyomiru's "Anime" library filter is therefore a synonym for
 *     "any animated TV content" — Western cartoons (Arcane, etc.) are
 *     included by design.
 *  4. Otherwise preserve the current kind.
 *
 * Caller contract: signals.tmdb.genres must be populated with resolved genre
 * names before calling. searchTMDb() returns genres: [] (numeric genre_ids
 * only); callers must copy genres from fetchTMDbShowTree() first.
 */
export function classifyKind(
  current: 'anime' | 'tv' | 'movie',
  signals: { tmdb?: TMDbMatch | null; anilist?: AniListMatch | null },
): 'anime' | 'tv' | 'movie' {
  if (current === 'movie') return 'movie'
  if (signals.anilist && signals.anilist.confidence >= 0.9) return 'anime'
  if (signals.tmdb?.genres.some((g) => g.toLowerCase().includes('anim'))) return 'anime'
  return current
}
