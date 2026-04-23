import { describe, it, expect, vi } from 'vitest'

describe('isWatched', () => {
  it('returns true when fully_watched is true', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(0, 1000, true)).toBe(true)
  })

  it('returns true when playhead >= 90% duration', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(900, 1000, false)).toBe(true)
    expect(isWatched(890, 1000, false)).toBe(false)
  })

  it('returns false when no duration available', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(500, undefined, false)).toBe(false)
  })
})
