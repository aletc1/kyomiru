import { describe, it, expect } from 'vitest'
import { decideShowStatus } from '../services/stateMachine.js'
import type { StatusInput } from '../services/stateMachine.js'

const base: StatusInput = {
  total: 12,
  watched: 6,
  latestAiredSeasonUnwatched: false,
  existingStatus: 'in_progress',
  existingTotalEpisodes: 12,
  existingQueuePosition: 3,
}

describe('decideShowStatus', () => {
  it('returns watched when all episodes are watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 12 }).status).toBe('watched')
  })

  it('clears queue position when transitioning to watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 12 }).queuePosition).toBeNull()
  })

  it('returns in_progress when partially watched (single season, none fully skipped)', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 6 }).status).toBe('in_progress')
  })

  it('returns in_progress when nothing has been watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 0 }).status).toBe('in_progress')
  })

  it('preserves queue position when not transitioning to watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 6 }).queuePosition).toBe(3)
  })

  it('does not transition to watched when total is 0 (unenriched show)', () => {
    expect(decideShowStatus({ ...base, total: 0, watched: 0 }).status).toBe('in_progress')
  })

  describe('watched → new_content', () => {
    it('flips to new_content when a new episode appears for a fully-watched show', () => {
      const result = decideShowStatus({
        total: 13,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'watched',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })

    it('does NOT flip when total did not increase even though watched < total', () => {
      // e.g. a recompute where counts dropped due to data correction
      const result = decideShowStatus({
        total: 12,
        watched: 11,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'watched',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('in_progress')
    })

    it('does NOT flip when user is still fully caught up', () => {
      const result = decideShowStatus({
        total: 12,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'watched',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('watched')
    })
  })

  describe('new_content stickiness', () => {
    it('stays new_content while user has not caught up', () => {
      const result = decideShowStatus({
        total: 13,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'new_content',
        existingTotalEpisodes: 13,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })

    it('clears new_content once user fully catches up', () => {
      const result = decideShowStatus({
        total: 13,
        watched: 13,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'new_content',
        existingTotalEpisodes: 13,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('watched')
    })

    it('stays new_content even when yet more episodes appear', () => {
      const result = decideShowStatus({
        total: 15,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'new_content',
        existingTotalEpisodes: 14,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })
  })

  describe('latest-season new_content', () => {
    it('flips in_progress to new_content when the latest aired season is unwatched and user has started the show', () => {
      const result = decideShowStatus({
        total: 37,
        watched: 1,
        latestAiredSeasonUnwatched: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 37,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })

    it('does NOT fire when user has watched nothing (cold add to library)', () => {
      const result = decideShowStatus({
        total: 24,
        watched: 0,
        latestAiredSeasonUnwatched: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 24,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('in_progress')
    })

    it('does NOT fire for single-season partial watch with no skipped seasons', () => {
      const result = decideShowStatus({
        total: 12,
        watched: 6,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('in_progress')
    })

    it('does NOT fire when only an early season is wholly skipped but the latest has progress', () => {
      const result = decideShowStatus({
        total: 24,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 24,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('in_progress')
    })

    it('watched beats latest-season rule when user is fully caught up', () => {
      const result = decideShowStatus({
        total: 12,
        watched: 12,
        latestAiredSeasonUnwatched: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('watched')
    })
  })
})
