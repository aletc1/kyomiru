import { describe, it, expect } from 'vitest'

// Integration tests for ingestChunk / finalizeIngestRun / resolveShowCatalogStatus
// require a running Postgres instance. Run with `pnpm db:up` first.
// TODO: add integration coverage once test-DB helpers are available.

describe('isWatched', () => {
  it('returns true when fullyWatched is true regardless of playhead', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(0, 0, true)).toBe(true)
    expect(isWatched(undefined, undefined, true)).toBe(true)
  })

  it('returns true at exactly the 90 % threshold', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(900, 1000, false)).toBe(true)
    expect(isWatched(899, 1000, false)).toBe(false)
  })

  it('returns false when duration is zero (avoids divide-by-zero)', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(0, 0, false)).toBe(false)
  })

  it('returns false when playhead or duration is undefined', async () => {
    const { isWatched } = await import('../services/sync.service.js')
    expect(isWatched(undefined, 1000, false)).toBe(false)
    expect(isWatched(900, undefined, false)).toBe(false)
  })
})
