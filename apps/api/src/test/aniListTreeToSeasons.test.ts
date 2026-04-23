import { describe, it, expect } from 'vitest'
import { aniListTreeToSeasons } from '@kyomiru/providers/enrichment/anilist'

describe('aniListTreeToSeasons', () => {
  it('returns empty when count is zero and no streaming titles', () => {
    expect(aniListTreeToSeasons({
      id: 1, title: 't', genres: [], streamingEpisodeTitles: [], confidence: 1,
    })).toEqual([])
  })

  it('synthesises one season with N numbered episodes', () => {
    const trees = aniListTreeToSeasons({
      id: 1, title: 't', genres: [], streamingEpisodeTitles: [], confidence: 1, episodes: 3,
    })
    expect(trees).toHaveLength(1)
    expect(trees[0]?.number).toBe(1)
    expect(trees[0]?.episodes.map((e) => e.number)).toEqual([1, 2, 3])
  })

  it('pulls titles from streamingEpisodes by index when available', () => {
    const trees = aniListTreeToSeasons({
      id: 1, title: 't', genres: [], streamingEpisodeTitles: ['Ep A', 'Ep B'], confidence: 1, episodes: 3,
    })
    const eps = trees[0]?.episodes ?? []
    expect(eps[0]?.title).toBe('Ep A')
    expect(eps[1]?.title).toBe('Ep B')
    expect(eps[2]?.title).toBeUndefined()
  })

  it('uses max(episodes, streamingTitles.length) so a shorter count doesn\'t truncate known titles', () => {
    const trees = aniListTreeToSeasons({
      id: 1, title: 't', genres: [], streamingEpisodeTitles: ['Ep A', 'Ep B', 'Ep C'], confidence: 1, episodes: 1,
    })
    expect(trees[0]?.episodes).toHaveLength(3)
  })
})
