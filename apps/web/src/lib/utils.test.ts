import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { formatRelative } from './utils'

const NOW = new Date('2026-04-25T12:00:00Z').getTime()

describe('formatRelative', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('returns null for null/undefined input', () => {
    expect(formatRelative(null)).toBeNull()
    expect(formatRelative(undefined)).toBeNull()
  })

  it('renders English by default', () => {
    const oneHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString()
    const out = formatRelative(oneHourAgo, 'en-US')
    expect(out).toMatch(/hour ago/)
  })

  it('renders Spanish when locale is es-ES', () => {
    const fiveDaysAgo = new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString()
    const out = formatRelative(fiveDaysAgo, 'es-ES')
    expect(out).toMatch(/hace 5 d/i)
  })

  it('renders French when locale is fr-FR', () => {
    const threeMonthsAgo = new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString()
    const out = formatRelative(threeMonthsAgo, 'fr-FR')
    expect(out).toMatch(/il y a 3 mois/)
  })

  it('uses minutes for sub-hour deltas', () => {
    const tenMinAgo = new Date(NOW - 10 * 60 * 1000).toISOString()
    expect(formatRelative(tenMinAgo, 'en-US')).toMatch(/10 minutes ago/)
  })

  it('uses years for >= 1 year deltas', () => {
    const twoYearsAgo = new Date(NOW - 2 * 365 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelative(twoYearsAgo, 'en-US')).toMatch(/2 years ago/)
  })
})
