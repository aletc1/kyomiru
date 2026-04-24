import { describe, it, expect } from 'vitest'
import { parseSeasonDescriptor, netflixAdapter } from './netflix.js'
import type { NetflixViewedItem } from './netflix.js'

describe('parseSeasonDescriptor', () => {
  it('parses full "Season N: Episode M" format', () => {
    expect(parseSeasonDescriptor('Season 2: Episode 5')).toEqual({ seasonNumber: 2, episodeNumber: 5 })
  })

  it('parses season/episode with different separators', () => {
    expect(parseSeasonDescriptor('Season 1 Episode 3')).toEqual({ seasonNumber: 1, episodeNumber: 3 })
  })

  it('parses episode-only format', () => {
    expect(parseSeasonDescriptor('Episode 3')).toEqual({ seasonNumber: 1, episodeNumber: 3 })
  })

  it('parses English season-only format', () => {
    expect(parseSeasonDescriptor('Season 2')).toEqual({ seasonNumber: 2, episodeNumber: 0 })
  })

  it('parses Spanish "Temporada N"', () => {
    expect(parseSeasonDescriptor('Temporada 2')).toEqual({ seasonNumber: 2, episodeNumber: 0 })
  })

  it('parses Netflix\'s "2nd Temporada" ordinal form', () => {
    expect(parseSeasonDescriptor('2nd Temporada')).toEqual({ seasonNumber: 2, episodeNumber: 0 })
  })

  it('defaults to S1E0 for unrecognised format', () => {
    expect(parseSeasonDescriptor('Something random')).toEqual({ seasonNumber: 1, episodeNumber: 0 })
  })

  it('defaults to S1E0 for undefined', () => {
    expect(parseSeasonDescriptor(undefined)).toEqual({ seasonNumber: 1, episodeNumber: 0 })
  })
})

describe('netflixAdapter.buildItemsFromHistory', () => {
  const episode: NetflixViewedItem = {
    movieID: 12345,
    title: 'Season 1: Pilot',
    episodeTitle: 'Pilot',
    seriesTitle: 'My Show',
    series: 99999,
    seasonDescriptor: 'Season 1: Episode 1',
    date: new Date('2024-06-01').getTime(),
  }

  const movie: NetflixViewedItem = {
    movieID: 55555,
    title: 'Great Movie',
    date: new Date('2024-06-02').getTime(),
  }

  it('converts episode to IngestItem with externalShowId', () => {
    const [item] = netflixAdapter.buildItemsFromHistory([episode])
    expect(item!.externalItemId).toBe('12345')
    expect(item!.externalShowId).toBe('99999')
    expect(item!.fullyWatched).toBe(true)
    expect(item!.durationSeconds).toBeUndefined()
    expect(item!.playheadSeconds).toBeUndefined()
  })

  it('converts movie to IngestItem without externalShowId', () => {
    const [item] = netflixAdapter.buildItemsFromHistory([movie])
    expect(item!.externalItemId).toBe('55555')
    expect(item!.externalShowId).toBeUndefined()
    // Netflix's AUI endpoint only reports fully-watched items, so we always
    // flag as watched regardless of whether a bookmark is surfaced.
    expect(item!.fullyWatched).toBe(true)
  })
})

describe('netflixAdapter.buildShowFromHistoryFallback', () => {
  it('synthesises episode numbers by sorting movieIDs ascending within each season', () => {
    // Netflix doesn't give episode numbers; AUI endpoint returns only the
    // season (e.g. "Temporada 1"). We rank by movieID so episodes don't
    // collapse onto `number: 0` on the server.
    const items: NetflixViewedItem[] = [
      { movieID: 205, title: 'Temporada 1: Ep three', episodeTitle: 'Ep three', seriesTitle: 'My Show', series: 100, seasonDescriptor: 'Temporada 1', date: 0 },
      { movieID: 201, title: 'Temporada 1: Ep one',   episodeTitle: 'Ep one',   seriesTitle: 'My Show', series: 100, seasonDescriptor: 'Temporada 1', date: 0 },
      { movieID: 203, title: 'Temporada 1: Ep two',   episodeTitle: 'Ep two',   seriesTitle: 'My Show', series: 100, seasonDescriptor: 'Temporada 1', date: 0 },
      { movieID: 311, title: 'Temporada 2: Ep one',   episodeTitle: 'Ep one S2', seriesTitle: 'My Show', series: 100, seasonDescriptor: 'Temporada 2', date: 0 },
    ]

    const show = netflixAdapter.buildShowFromHistoryFallback('100', items)
    expect(show).not.toBeNull()
    expect(show!.title).toBe('My Show')
    expect(show!.seasons).toHaveLength(2)

    const s1 = show!.seasons.find((s) => s.number === 1)!
    expect(s1.episodes).toHaveLength(3)
    expect(s1.episodes[0]).toMatchObject({ number: 1, title: 'Ep one',   externalId: '201' })
    expect(s1.episodes[1]).toMatchObject({ number: 2, title: 'Ep two',   externalId: '203' })
    expect(s1.episodes[2]).toMatchObject({ number: 3, title: 'Ep three', externalId: '205' })

    const s2 = show!.seasons.find((s) => s.number === 2)!
    expect(s2.episodes).toHaveLength(1)
    expect(s2.episodes[0]).toMatchObject({ number: 1, externalId: '311' })
  })

  it('dedupes by movieID so repeat views do not create duplicate episodes', () => {
    const items: NetflixViewedItem[] = [
      { movieID: 201, title: 'Temporada 1: Ep', episodeTitle: 'Ep', seriesTitle: 'X', series: 1, seasonDescriptor: 'Temporada 1', date: 100 },
      { movieID: 201, title: 'Temporada 1: Ep', episodeTitle: 'Ep', seriesTitle: 'X', series: 1, seasonDescriptor: 'Temporada 1', date: 200 },
    ]
    const show = netflixAdapter.buildShowFromHistoryFallback('1', items)
    expect(show!.seasons[0]!.episodes).toHaveLength(1)
  })

  it('returns null for empty history', () => {
    expect(netflixAdapter.buildShowFromHistoryFallback('100', [])).toBeNull()
  })
})

describe('netflixAdapter.toCheckpointItem', () => {
  it('maps episode to checkpoint item with season/episode numbers', () => {
    const item: NetflixViewedItem = {
      movieID: 777, title: 'Season 3: Ep', series: 888,
      seasonDescriptor: 'Season 3: Episode 7',
      date: 0,
    }
    const cp = netflixAdapter.toCheckpointItem(item)
    expect(cp.id).toBe('777')
    expect(cp.showId).toBe('888')
    expect(cp.seasonNumber).toBe(3)
    expect(cp.episodeNumber).toBe(7)
  })

  it('maps movie to checkpoint item without showId', () => {
    const item: NetflixViewedItem = { movieID: 999, title: 'Movie', date: 0 }
    const cp = netflixAdapter.toCheckpointItem(item)
    expect(cp.id).toBe('999')
    expect(cp.showId).toBeUndefined()
  })
})

describe('netflixAdapter.streamCatalogsForShows', () => {
  it('yields no catalogs but reports every show id as failed so the core sync falls back', async () => {
    const progress: Array<{ showId: string; ok: boolean; reason?: string }> = []
    const yielded: unknown[] = []
    const gen = netflixAdapter.streamCatalogsForShows(['s1', 's2', 's3'], (ev) => {
      progress.push({ showId: ev.showId, ok: ev.ok, ...(ev.reason !== undefined && { reason: ev.reason }) })
    })
    for await (const cat of gen) yielded.push(cat)

    expect(yielded).toEqual([])
    expect(progress).toHaveLength(3)
    expect(progress.every((p) => p.ok === false)).toBe(true)
    expect(progress.map((p) => p.showId)).toEqual(['s1', 's2', 's3'])
  })

  it('is a no-op for an empty show list', async () => {
    const progress: unknown[] = []
    const gen = netflixAdapter.streamCatalogsForShows([], (ev) => { progress.push(ev) })
    for await (const _cat of gen) { /* drain */ }
    expect(progress).toEqual([])
  })
})
