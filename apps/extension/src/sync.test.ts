import { describe, it, expect } from 'vitest'
import { isSeriesFresh, classifySeriesIds } from './sync.js'
import type { CheckpointHistoryItem } from './storage.js'

function makeItem(seasonNumber: number, episodeNumber: number): CheckpointHistoryItem {
  return {
    id: 'item-1',
    date_played: '2024-01-01T00:00:00Z',
    playhead: 100,
    fully_watched: true,
    panel: {
      id: 'panel-1',
      episode_metadata: { series_id: 'series-1', season_number: seasonNumber, episode_number: episodeNumber },
    },
  }
}

const orphanItem: CheckpointHistoryItem = { id: 'x', date_played: '', playhead: 0, fully_watched: false }

describe('isSeriesFresh', () => {
  it('returns false when series is unknown', () => {
    expect(isSeriesFresh({ known: false, catalogSyncedAt: null, seasonCoverage: {} }, [])).toBe(false)
  })

  it('returns false when seasonCoverage is empty', () => {
    expect(isSeriesFresh({ known: true, catalogSyncedAt: null, seasonCoverage: {} }, [makeItem(1, 1)])).toBe(false)
  })

  it('returns true when all items fall within per-season coverage', () => {
    const info = { known: true, catalogSyncedAt: null, seasonCoverage: { '1': 12, '2': 6 } }
    expect(isSeriesFresh(info, [makeItem(1, 12), makeItem(2, 5)])).toBe(true)
  })

  it('returns false when an item episode exceeds its season coverage', () => {
    const info = { known: true, catalogSyncedAt: null, seasonCoverage: { '1': 10, '2': 6 } }
    expect(isSeriesFresh(info, [makeItem(1, 11)])).toBe(false)
  })

  it('returns false when an item season is not in coverage at all (regression: old bug)', () => {
    // Old bug: only checked max-season, so S1 E999 passed when maxSeason=2.
    const info = { known: true, catalogSyncedAt: null, seasonCoverage: { '2': 6 } }
    expect(isSeriesFresh(info, [makeItem(1, 999)])).toBe(false)
  })

  it('ignores items without season/episode metadata', () => {
    const info = { known: true, catalogSyncedAt: null, seasonCoverage: { '1': 10 } }
    expect(isSeriesFresh(info, [orphanItem, makeItem(1, 5)])).toBe(true)
  })

  it('returns true for an empty history list when series is known', () => {
    const info = { known: true, catalogSyncedAt: null, seasonCoverage: { '1': 10 } }
    expect(isSeriesFresh(info, [])).toBe(true)
  })
})

describe('classifySeriesIds', () => {
  const freshInfo = { known: true, catalogSyncedAt: null, seasonCoverage: { '1': 10 } }
  const unknownInfo = { known: false, catalogSyncedAt: null, seasonCoverage: {} }

  it('classifies known+fresh series as fresh', () => {
    const resolveMap = new Map([['a', freshInfo]])
    const { freshIds, slowIds } = classifySeriesIds(['a'], resolveMap, { a: [makeItem(1, 5)] })
    expect(freshIds).toEqual(['a'])
    expect(slowIds).toEqual([])
  })

  it('classifies unknown series as slow', () => {
    const resolveMap = new Map([['b', unknownInfo]])
    const { freshIds, slowIds } = classifySeriesIds(['b'], resolveMap, { b: [makeItem(1, 1)] })
    expect(freshIds).toEqual([])
    expect(slowIds).toEqual(['b'])
  })

  it('classifies series with no resolve info as slow', () => {
    const { freshIds, slowIds } = classifySeriesIds(['c'], new Map(), {})
    expect(freshIds).toEqual([])
    expect(slowIds).toEqual(['c'])
  })

  it('classifies stale series (episode beyond coverage) as slow', () => {
    const resolveMap = new Map([['d', freshInfo]])
    const { freshIds, slowIds } = classifySeriesIds(['d'], resolveMap, { d: [makeItem(1, 11)] })
    expect(freshIds).toEqual([])
    expect(slowIds).toEqual(['d'])
  })

  it('handles a mix correctly', () => {
    const resolveMap = new Map([['a', freshInfo], ['b', unknownInfo]])
    const history = { a: [makeItem(1, 5)], b: [makeItem(1, 1)] }
    const { freshIds, slowIds } = classifySeriesIds(['a', 'b', 'c'], resolveMap, history)
    expect(freshIds).toEqual(['a'])
    expect(slowIds).toContain('b')
    expect(slowIds).toContain('c')
    expect(slowIds).toHaveLength(2)
  })
})
