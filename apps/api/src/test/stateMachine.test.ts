import { describe, it, expect } from 'vitest'
import { decideShowStatus } from '../services/stateMachine.js'
import type { StatusInput } from '../services/stateMachine.js'

const base: StatusInput = {
  total: 12,
  watched: 6,
  latestAiredSeasonUnwatched: false,
  hasActionable: true,
  hasUpcoming: false,
  existingStatus: 'in_progress',
  existingTotalEpisodes: 12,
  existingQueuePosition: 3,
}

describe('decideShowStatus', () => {
  it('returns watched when all episodes are watched and no future eps', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 12, hasActionable: false, hasUpcoming: false }).status).toBe('watched')
  })

  it('clears queue position when transitioning to watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 12, hasActionable: false, hasUpcoming: false }).queuePosition).toBeNull()
  })

  it('returns in_progress when partially watched (single season, none fully skipped)', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 6 }).status).toBe('in_progress')
  })

  it('returns in_progress when nothing has been watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 0, hasActionable: true }).status).toBe('in_progress')
  })

  it('preserves queue position when not transitioning to watched', () => {
    expect(decideShowStatus({ ...base, total: 12, watched: 6 }).queuePosition).toBe(3)
  })

  it('does not transition to watched when total is 0 (unenriched show)', () => {
    expect(decideShowStatus({ ...base, total: 0, watched: 0, hasActionable: false }).status).toBe('in_progress')
  })

  describe('coming_soon (branch 1b)', () => {
    it('returns coming_soon when W==T and there are upcoming episodes', () => {
      const result = decideShowStatus({
        ...base,
        total: 12,
        watched: 12,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 12,
      })
      expect(result.status).toBe('coming_soon')
    })

    it('queue position is preserved for coming_soon', () => {
      const result = decideShowStatus({
        ...base,
        total: 12,
        watched: 12,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 12,
        existingQueuePosition: 2,
      })
      expect(result.queuePosition).toBe(2)
    })
  })

  describe('coming_soon (branch CS — placeholder-padded shows)', () => {
    it('returns coming_soon when user is caught up on dated eps but T>W due to NULL placeholders', () => {
      // 12 dated-past watched + 5 NULL placeholders + 2 dated-future
      // total=17 (NULL counts), watched=12, hasActionable=false, hasUpcoming=true
      const result = decideShowStatus({
        ...base,
        total: 17,
        watched: 12,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 17,
      })
      expect(result.status).toBe('coming_soon')
    })

    it('does NOT fire CS when W == 0 (brand new show)', () => {
      const result = decideShowStatus({
        ...base,
        total: 5,
        watched: 0,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 5,
      })
      expect(result.status).toBe('in_progress')
    })

    it('transitions from new_content to coming_soon via CS when user catches up on dated eps', () => {
      const result = decideShowStatus({
        ...base,
        total: 17,
        watched: 12,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'new_content',
        existingTotalEpisodes: 17,
      })
      expect(result.status).toBe('coming_soon')
    })

    it('transitions from watched to coming_soon via CS (surprise revival with placeholders)', () => {
      const result = decideShowStatus({
        ...base,
        total: 17,
        watched: 12,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'watched',
        existingTotalEpisodes: 17,
      })
      expect(result.status).toBe('coming_soon')
    })
  })

  describe('watched → new_content', () => {
    it('flips to new_content when a new dated episode appears for a fully-watched show', () => {
      const result = decideShowStatus({
        total: 13,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        hasActionable: true,
        hasUpcoming: false,
        existingStatus: 'watched',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })

    it('does NOT flip when total did not increase even though watched < total', () => {
      const result = decideShowStatus({
        total: 12,
        watched: 11,
        latestAiredSeasonUnwatched: false,
        hasActionable: true,
        hasUpcoming: false,
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
        hasActionable: false,
        hasUpcoming: false,
        existingStatus: 'watched',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('watched')
    })
  })

  describe('coming_soon → new_content (branch 2 widened)', () => {
    it('flips from coming_soon to new_content when a dated ep crosses today and catalog grew', () => {
      const result = decideShowStatus({
        total: 18,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        hasActionable: true,
        hasUpcoming: true,
        existingStatus: 'coming_soon',
        existingTotalEpisodes: 17,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })

    it('does NOT flip from coming_soon to new_content when T did not grow', () => {
      // hasActionable but T==eT — e.g. an air_date correction, not a new ep
      const result = decideShowStatus({
        total: 17,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        hasActionable: true,
        hasUpcoming: true,
        existingStatus: 'coming_soon',
        existingTotalEpisodes: 17,
        existingQueuePosition: null,
      })
      // Falls to branch 4 (LSU=false) → in_progress
      expect(result.status).toBe('in_progress')
    })
  })

  describe('new_content stickiness', () => {
    it('stays new_content while there is something actionable to watch', () => {
      const result = decideShowStatus({
        total: 13,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        hasActionable: true,
        hasUpcoming: false,
        existingStatus: 'new_content',
        existingTotalEpisodes: 13,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })

    it('exits new_content → watched when user fully catches up (no upcoming)', () => {
      const result = decideShowStatus({
        total: 13,
        watched: 13,
        latestAiredSeasonUnwatched: false,
        hasActionable: false,
        hasUpcoming: false,
        existingStatus: 'new_content',
        existingTotalEpisodes: 13,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('watched')
    })

    it('exits new_content → coming_soon when user catches up on dated eps (placeholder-padded show)', () => {
      const result = decideShowStatus({
        total: 17,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'new_content',
        existingTotalEpisodes: 17,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('coming_soon')
    })

    it('stays new_content even when yet more episodes appear (still actionable)', () => {
      const result = decideShowStatus({
        total: 15,
        watched: 12,
        latestAiredSeasonUnwatched: false,
        hasActionable: true,
        hasUpcoming: false,
        existingStatus: 'new_content',
        existingTotalEpisodes: 14,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })
  })

  describe('latest-season new_content (branch 4)', () => {
    it('flips in_progress to new_content when the latest aired season is unwatched and user has started the show', () => {
      const result = decideShowStatus({
        total: 37,
        watched: 1,
        latestAiredSeasonUnwatched: true,
        hasActionable: true,
        hasUpcoming: false,
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
        hasActionable: true,
        hasUpcoming: false,
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
        hasActionable: true,
        hasUpcoming: false,
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
        hasActionable: true,
        hasUpcoming: false,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 24,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('in_progress')
    })

    it('does NOT fire when hasActionable is false (latest "season" is all NULL placeholders)', () => {
      const result = decideShowStatus({
        total: 17,
        watched: 12,
        latestAiredSeasonUnwatched: true,
        hasActionable: false,
        hasUpcoming: true,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 17,
        existingQueuePosition: null,
      })
      // hasActionable=false gates branch 4; falls to CS (hasUpcoming=true, W>0) → coming_soon
      expect(result.status).toBe('coming_soon')
    })

    it('watched beats latest-season rule when user is fully caught up', () => {
      const result = decideShowStatus({
        total: 12,
        watched: 12,
        latestAiredSeasonUnwatched: true,
        hasActionable: false,
        hasUpcoming: false,
        existingStatus: 'in_progress',
        existingTotalEpisodes: 12,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('watched')
    })
  })
})
