import { describe, it, expect } from 'vitest'
import {
  isWatched,
  mergeSeasonInBatch,
  mergeEpisodeInBatch,
  type SeasonInsertValue,
} from '../services/sync.service.js'

// Integration tests for ingestChunk / finalizeIngestRun / resolveShowCatalogStatus
// require a running Postgres instance. Run with `pnpm db:up` first.
// TODO: add integration coverage once test-DB helpers are available.

describe('isWatched', () => {
  it('returns true when fullyWatched is true regardless of playhead', () => {
    expect(isWatched(0, 0, true)).toBe(true)
    expect(isWatched(undefined, undefined, true)).toBe(true)
  })

  it('returns true at exactly the 90 % threshold', () => {
    expect(isWatched(900, 1000, false)).toBe(true)
    expect(isWatched(899, 1000, false)).toBe(false)
  })

  it('returns false when duration is zero (avoids divide-by-zero)', () => {
    expect(isWatched(0, 0, false)).toBe(false)
  })

  it('returns false when playhead or duration is undefined', () => {
    expect(isWatched(undefined, 1000, false)).toBe(false)
    expect(isWatched(900, undefined, false)).toBe(false)
  })
})

// Regression coverage for the in-batch dedup: prior versions of upsertShowCatalog
// crashed with "ON CONFLICT DO UPDATE command cannot affect row a second time"
// when fractional ordinals (e.g. season 2.5 / episode 11.5) floored to an
// integer that was already in the same batch.
describe('mergeSeasonInBatch', () => {
  const base: SeasonInsertValue = {
    showId: 'show-1',
    seasonNumber: 2,
    title: null,
    airDate: null,
    episodeCount: 0,
    titles: {},
  }

  it('keeps prev.title (first-non-null wins) and merges titles JSONB with next winning shared keys', () => {
    const prev = { ...base, title: 'Season 2', titles: { en: 'Season 2', ja: '第2期' } }
    const next = { ...base, title: 'OVA Specials', titles: { en: 'OVAs', es: 'Temporada 2' } }
    const merged = mergeSeasonInBatch(prev, next)
    expect(merged.title).toBe('Season 2')
    expect(merged.titles).toEqual({ en: 'OVAs', ja: '第2期', es: 'Temporada 2' })
  })

  it('falls through to next.title when prev.title is null', () => {
    const prev = { ...base, title: null }
    const next = { ...base, title: 'OVA Specials' }
    expect(mergeSeasonInBatch(prev, next).title).toBe('OVA Specials')
  })

  it('takes the max episodeCount (mirrors GREATEST in SQL ON CONFLICT)', () => {
    const prev = { ...base, episodeCount: 12 }
    const next = { ...base, episodeCount: 4 }
    expect(mergeSeasonInBatch(prev, next).episodeCount).toBe(12)
    expect(mergeSeasonInBatch(next, prev).episodeCount).toBe(12)
  })

  it('keeps prev.airDate if set', () => {
    const prev = { ...base, airDate: '2024-01-01' }
    const next = { ...base, airDate: '2024-06-01' }
    expect(mergeSeasonInBatch(prev, next).airDate).toBe('2024-01-01')
  })
})

describe('mergeEpisodeInBatch', () => {
  const base = {
    seasonId: 'season-1',
    showId: 'show-1',
    episodeNumber: 11,
    title: null,
    titles: {} as Record<string, string>,
    descriptions: {} as Record<string, string>,
    durationSeconds: null,
    airDate: null,
  }

  it('mirrors COALESCE for scalar fields (prev wins when set)', () => {
    const prev = { ...base, title: 'Episode 11', durationSeconds: 1440, airDate: '2024-03-15' }
    const next = { ...base, title: 'Recap 11.5', durationSeconds: 600, airDate: '2024-03-22' }
    const merged = mergeEpisodeInBatch(prev, next)
    expect(merged.title).toBe('Episode 11')
    expect(merged.durationSeconds).toBe(1440)
    expect(merged.airDate).toBe('2024-03-15')
  })

  it('falls through to next when prev fields are null', () => {
    const prev = { ...base, title: null, durationSeconds: null, airDate: null }
    const next = { ...base, title: 'Recap', durationSeconds: 600, airDate: '2024-03-22' }
    const merged = mergeEpisodeInBatch(prev, next)
    expect(merged.title).toBe('Recap')
    expect(merged.durationSeconds).toBe(600)
    expect(merged.airDate).toBe('2024-03-22')
  })

  it('merges titles and descriptions JSONB with next winning shared keys', () => {
    const prev = {
      ...base,
      titles: { en: 'Episode 11', ja: '第11話' },
      descriptions: { en: 'Original synopsis' },
    }
    const next = {
      ...base,
      titles: { en: 'Recap 11.5', es: 'Episodio 11' },
      descriptions: { en: 'Updated synopsis', ja: '日本語' },
    }
    const merged = mergeEpisodeInBatch(prev, next)
    expect(merged.titles).toEqual({ en: 'Recap 11.5', ja: '第11話', es: 'Episodio 11' })
    expect(merged.descriptions).toEqual({ en: 'Updated synopsis', ja: '日本語' })
  })
})
