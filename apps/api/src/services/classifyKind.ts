import type { TMDbMatch } from '@kyomiru/providers/enrichment/tmdb'
import type { AniListMatch } from '@kyomiru/providers/enrichment/anilist'

/**
 * Derive the canonical show kind from enrichment signals.
 *
 * Rules:
 *  1. Movies are never reclassified (enrichment doesn't change movie→tv).
 *  2. A high-confidence AniList match (≥ 0.9) is definitive — AniList only
 *     contains anime, so matching there means it's anime.
 *  3. If TMDB reports original_language=ja and the "Animation" genre, the
 *     show is Japanese animation i.e. anime. This catches Netflix shows that
 *     were seeded as 'tv' by the extension adapter.
 *  4. Otherwise preserve the current kind.
 */
export function classifyKind(
  current: 'anime' | 'tv' | 'movie',
  signals: { tmdb?: TMDbMatch | null; anilist?: AniListMatch | null },
): 'anime' | 'tv' | 'movie' {
  if (current === 'movie') return 'movie'
  if (signals.anilist && signals.anilist.confidence >= 0.9) return 'anime'
  if (
    signals.tmdb?.originalLanguage === 'ja' &&
    signals.tmdb.genres.some((g) => g.toLowerCase() === 'animation')
  ) return 'anime'
  return current
}
