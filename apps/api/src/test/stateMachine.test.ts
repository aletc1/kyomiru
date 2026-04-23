import { describe, it, expect } from 'vitest'
import { decideShowStatus } from '../services/stateMachine.js'
import type { StatusInput } from '../services/stateMachine.js'

const base: StatusInput = {
  total: 12,
  watched: 6,
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

  it('returns in_progress when partially watched', () => {
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
        existingStatus: 'new_content',
        existingTotalEpisodes: 14,
        existingQueuePosition: null,
      })
      expect(result.status).toBe('new_content')
    })
  })
})
