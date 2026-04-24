import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSeriesFresh, classifyShowIds, pingKyomiru, KyomiruAuthError } from './sync.js'
import type { CheckpointItem } from './providers/types.js'

function makeItem(seasonNumber: number, episodeNumber: number): CheckpointItem {
  return {
    id: 'item-1',
    showId: 'show-1',
    seasonNumber,
    episodeNumber,
    raw: {},
  }
}

const orphanItem: CheckpointItem = { id: 'x', raw: {} }

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

describe('classifyShowIds', () => {
  const freshInfo = { known: true, catalogSyncedAt: null, seasonCoverage: { '1': 10 } }
  const unknownInfo = { known: false, catalogSyncedAt: null, seasonCoverage: {} }

  it('classifies known+fresh shows as fresh', () => {
    const resolveMap = new Map([['a', freshInfo]])
    const { freshIds, slowIds } = classifyShowIds(['a'], resolveMap, { a: [makeItem(1, 5)] })
    expect(freshIds).toEqual(['a'])
    expect(slowIds).toEqual([])
  })

  it('classifies unknown shows as slow', () => {
    const resolveMap = new Map([['b', unknownInfo]])
    const { freshIds, slowIds } = classifyShowIds(['b'], resolveMap, { b: [makeItem(1, 1)] })
    expect(freshIds).toEqual([])
    expect(slowIds).toEqual(['b'])
  })

  it('classifies shows with no resolve info as slow', () => {
    const { freshIds, slowIds } = classifyShowIds(['c'], new Map(), {})
    expect(freshIds).toEqual([])
    expect(slowIds).toEqual(['c'])
  })

  it('classifies stale shows (episode beyond coverage) as slow', () => {
    const resolveMap = new Map([['d', freshInfo]])
    const { freshIds, slowIds } = classifyShowIds(['d'], resolveMap, { d: [makeItem(1, 11)] })
    expect(freshIds).toEqual([])
    expect(slowIds).toEqual(['d'])
  })

  it('handles a mix correctly', () => {
    const resolveMap = new Map([['a', freshInfo], ['b', unknownInfo]])
    const history = { a: [makeItem(1, 5)], b: [makeItem(1, 1)] }
    const { freshIds, slowIds } = classifyShowIds(['a', 'b', 'c'], resolveMap, history)
    expect(freshIds).toEqual(['a'])
    expect(slowIds).toContain('b')
    expect(slowIds).toContain('c')
    expect(slowIds).toHaveLength(2)
  })
})

describe('pingKyomiru', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('throws KyomiruAuthError on HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Invalid or revoked token', { status: 401 }),
    ))
    await expect(pingKyomiru('http://localhost:3000', 'bad-token'))
      .rejects.toBeInstanceOf(KyomiruAuthError)
  })

  it('throws a generic Error on non-401 failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 }),
    ))
    await expect(pingKyomiru('http://localhost:3000', 'x'))
      .rejects.toThrow(/HTTP 500/)
  })

  it('returns the user payload on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '1', email: 'a@b', displayName: 'A' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    await expect(pingKyomiru('http://localhost:3000', 'ok')).resolves.toEqual({
      id: '1', email: 'a@b', displayName: 'A', preferredLocale: null,
    })
  })
})
