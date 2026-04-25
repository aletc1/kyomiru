import { describe, it, expect } from 'vitest'
import { classifyKind } from './classifyKind.js'
import type { TMDbMatch } from '@kyomiru/providers/enrichment/tmdb'
import type { AniListMatch } from '@kyomiru/providers/enrichment/anilist'

const animeTMDb: TMDbMatch = {
  id: 114410, title: 'Chainsaw Man', genres: ['Animation', 'Action & Adventure'],
  originalLanguage: 'ja', originCountry: ['JP'], confidence: 0.95,
}
const westernCartoon: TMDbMatch = {
  id: 94605, title: 'Arcane', genres: ['Animation', 'Action & Adventure', 'Sci-Fi & Fantasy'],
  originalLanguage: 'fr', originCountry: ['FR'], confidence: 0.97,
}
const tvShow: TMDbMatch = {
  id: 1396, title: 'Breaking Bad', genres: ['Drama', 'Crime'],
  originalLanguage: 'en', originCountry: ['US'], confidence: 0.99,
}
const highConfAnilist: AniListMatch = {
  id: 101922, canonicalTitle: 'Devilman Crybaby', titles: { en: 'Devilman Crybaby', ja: 'デビルマンクライベイビー' },
  genres: ['Action', 'Demons'], streamingEpisodeTitles: [], confidence: 0.95,
}
const lowConfAnilist: AniListMatch = {
  id: 9999, canonicalTitle: 'Something', titles: { en: 'Something' },
  genres: [], streamingEpisodeTitles: [], confidence: 0.75,
}

describe('classifyKind', () => {
  it('promotes Animation-genre show to anime (e.g. Netflix-seeded JP anime)', () => {
    expect(classifyKind('tv', { tmdb: animeTMDb })).toBe('anime')
  })

  it('promotes any Animation-genre show to anime regardless of origin', () => {
    expect(classifyKind('tv', { tmdb: westernCartoon })).toBe('anime')
  })

  it('preserves tv for non-animation show', () => {
    expect(classifyKind('tv', { tmdb: tvShow })).toBe('tv')
  })

  it('promotes to anime on high-confidence AniList match', () => {
    expect(classifyKind('tv', { anilist: highConfAnilist })).toBe('anime')
  })

  it('does not promote on low-confidence AniList match', () => {
    expect(classifyKind('tv', { anilist: lowConfAnilist })).toBe('tv')
  })

  it('promotes at the confidence boundary (exactly 0.9)', () => {
    const boundary: AniListMatch = { ...highConfAnilist, confidence: 0.9 }
    expect(classifyKind('tv', { anilist: boundary })).toBe('anime')
  })

  it('does not promote just below the boundary (0.89)', () => {
    const justBelow: AniListMatch = { ...highConfAnilist, confidence: 0.89 }
    expect(classifyKind('tv', { anilist: justBelow })).toBe('tv')
  })

  it('never changes movie kind', () => {
    expect(classifyKind('movie', { tmdb: animeTMDb, anilist: highConfAnilist })).toBe('movie')
  })

  it('preserves existing anime kind when no signals', () => {
    expect(classifyKind('anime', {})).toBe('anime')
  })

  // Regression: searchTMDb returns genres: [] because /search/tv only yields
  // numeric genre_ids. Callers must copy genres from fetchTMDbShowTree() first.
  it('does not promote when TMDb genres are empty (raw /search/tv result)', () => {
    const rawSearchMatch: TMDbMatch = {
      id: 41588, title: 'Highschool of the Dead',
      genres: [], originalLanguage: 'ja', originCountry: ['JP'], confidence: 0.92,
    }
    expect(classifyKind('tv', { tmdb: rawSearchMatch })).toBe('tv')
  })

  it('matches genres containing "anim" case-insensitively', () => {
    const animeGenre: TMDbMatch = { ...animeTMDb, genres: ['Anime'] }
    expect(classifyKind('tv', { tmdb: animeGenre })).toBe('anime')

    const animatedGenre: TMDbMatch = { ...animeTMDb, genres: ['Animated', 'Drama'] }
    expect(classifyKind('tv', { tmdb: animatedGenre })).toBe('anime')
  })
})
