import { describe, it, expect } from 'vitest'
import { crunchyrollAdapter } from './crunchyroll.js'
import type { CrunchyrollHistoryItem } from './crunchyroll.js'

function makeHistoryItem(overrides: Partial<CrunchyrollHistoryItem> = {}): CrunchyrollHistoryItem {
  return {
    id: 'history-1',
    date_played: '2024-01-15T12:00:00Z',
    playhead: 1200,
    fully_watched: false,
    panel: {
      id: 'panel-1',
      episode_metadata: {
        series_id: 'series-abc',
        series_title: 'My Anime',
        season_id: 'season-1',
        season_number: 2,
        episode_number: 5,
        duration_ms: 1440000,
      },
    },
    ...overrides,
  }
}

describe('crunchyrollAdapter.toCheckpointItem', () => {
  it('extracts season and episode numbers into top-level fields', () => {
    const item = makeHistoryItem()
    const cp = crunchyrollAdapter.toCheckpointItem(item)
    expect(cp.id).toBe('panel-1')
    expect(cp.showId).toBe('series-abc')
    expect(cp.seasonNumber).toBe(2)
    expect(cp.episodeNumber).toBe(5)
  })

  it('falls back to history id when no panel', () => {
    const { panel: _panel, ...base } = makeHistoryItem()
    const item = base as CrunchyrollHistoryItem
    const cp = crunchyrollAdapter.toCheckpointItem(item)
    expect(cp.id).toBe('history-1')
    expect(cp.showId).toBeUndefined()
  })
})

describe('crunchyrollAdapter.buildItemsFromHistory', () => {
  it('converts history rows to IngestItems', () => {
    const item = makeHistoryItem()
    const [ingest] = crunchyrollAdapter.buildItemsFromHistory([item])
    expect(ingest!.externalItemId).toBe('panel-1')
    expect(ingest!.externalShowId).toBe('series-abc')
    expect(ingest!.externalSeasonId).toBe('season-1')
    expect(ingest!.durationSeconds).toBe(1440)
    expect(ingest!.playheadSeconds).toBe(1200)
    expect(ingest!.fullyWatched).toBe(false)
  })
})

describe('crunchyrollAdapter.uniqueShowIds', () => {
  it('collects unique series ids', () => {
    const items = [
      makeHistoryItem(),
      makeHistoryItem({ panel: { id: 'panel-2', episode_metadata: { series_id: 'series-abc' } } }),
      makeHistoryItem({ panel: { id: 'panel-3', episode_metadata: { series_id: 'series-xyz' } } }),
    ]
    const ids = crunchyrollAdapter.uniqueShowIds(items)
    expect(ids).toHaveLength(2)
    expect(ids).toContain('series-abc')
    expect(ids).toContain('series-xyz')
  })
})

describe('crunchyrollAdapter.collectOrphans', () => {
  it('returns items with no series_id', () => {
    const withSeries = makeHistoryItem()
    const { panel: _panel, ...orphanBase } = makeHistoryItem()
    const orphan = orphanBase as CrunchyrollHistoryItem
    const orphans = crunchyrollAdapter.collectOrphans([withSeries, orphan])
    expect(orphans).toHaveLength(1)
  })
})

describe('crunchyrollAdapter.buildShowFromHistoryFallback', () => {
  it('builds a show tree from history when series_id is present', () => {
    const items = [
      makeHistoryItem(),
      makeHistoryItem({ panel: { id: 'panel-2', episode_metadata: { series_id: 'series-abc', season_number: 2, episode_number: 6 } } }),
    ]
    const show = crunchyrollAdapter.buildShowFromHistoryFallback('series-abc', items)
    expect(show).not.toBeNull()
    expect(show!.externalId).toBe('series-abc')
    expect(show!.kind).toBe('anime')
    const s2 = show!.seasons.find((s) => s.number === 2)
    expect(s2).toBeDefined()
    expect(s2!.episodes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('crunchyrollAdapter.hostMatches', () => {
  it('matches crunchyroll.com', () => {
    expect(crunchyrollAdapter.hostMatches(new URL('https://www.crunchyroll.com/watch/abc'))).toBe(true)
  })

  it('does not match netflix.com', () => {
    expect(crunchyrollAdapter.hostMatches(new URL('https://www.netflix.com/browse'))).toBe(false)
  })
})
