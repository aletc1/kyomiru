import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { crunchyrollAdapter, refreshCrunchyrollSession, decodeJwtExp } from './crunchyroll.js'
import type { CrunchyrollHistoryItem } from './crunchyroll.js'

// Mock the storage module module-wide so refreshCrunchyrollSession and
// crunchyrollAdapter.onRequest don't need a real chrome runtime. The pure-
// function tests above don't touch storage, so this doesn't affect them.
vi.mock('../storage.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  getStoredProfileId: vi.fn().mockResolvedValue(null),
  setStoredProfileId: vi.fn().mockResolvedValue(undefined),
}))

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

describe('decodeJwtExp', () => {
  function makeJwt(payload: object): string {
    const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `header.${encoded}.sig`
  }

  it('returns the exp claim when present', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    expect(decodeJwtExp(makeJwt({ exp }))).toBe(exp)
  })

  it('returns null when exp is missing', () => {
    expect(decodeJwtExp(makeJwt({ sub: 'user' }))).toBeNull()
  })

  it('returns null when the token has only one part', () => {
    expect(decodeJwtExp('onlyonepart')).toBeNull()
  })

  it('returns null when the payload is not valid base64-encoded JSON', () => {
    expect(decodeJwtExp('header.!!!notbase64.sig')).toBeNull()
  })
})

describe('refreshCrunchyrollSession', () => {
  const validProfileId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  beforeEach(async () => {
    const storage = await import('../storage.js')
    vi.mocked(storage.getSession).mockResolvedValue(null)
    vi.mocked(storage.setSession).mockResolvedValue(undefined)
    vi.mocked(storage.getStoredProfileId).mockResolvedValue(null)
    vi.mocked(storage.setStoredProfileId).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns false when the token endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await refreshCrunchyrollSession()).toBe(false)
  })

  it('returns false when access_token is missing from the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profile_id: validProfileId }),
    }))
    expect(await refreshCrunchyrollSession()).toBe(false)
  })

  it('returns false when profile_id is malformed and no stored fallback exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh.jwt.token', profile_id: 'not-a-uuid' }),
    }))
    expect(await refreshCrunchyrollSession()).toBe(false)
  })

  it('sends the cr_web Basic auth header that the token endpoint requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh.jwt.token', profile_id: validProfileId }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await refreshCrunchyrollSession()

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Basic Y3Jfd2ViOg==')
    expect(init.credentials).toBe('include')
    expect(init.body).toBe('grant_type=etp_rt_cookie')
  })

  it('stores the session when response contains a valid profile_id', async () => {
    const { setSession, setStoredProfileId } = await import('../storage.js')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh.jwt.token', profile_id: validProfileId }),
    }))

    expect(await refreshCrunchyrollSession()).toBe(true)
    expect(setStoredProfileId).toHaveBeenCalledWith('crunchyroll', validProfileId)
    expect(setSession).toHaveBeenCalledWith('crunchyroll', expect.objectContaining({
      jwt: 'fresh.jwt.token',
      profileId: validProfileId,
    }))
  })

  it('falls back to the durable stored profileId when response omits profile_id', async () => {
    const { setSession, getStoredProfileId } = await import('../storage.js')
    vi.mocked(getStoredProfileId).mockResolvedValue(validProfileId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'fresh.jwt.token' }),
    }))

    expect(await refreshCrunchyrollSession()).toBe(true)
    expect(setSession).toHaveBeenCalledWith('crunchyroll', expect.objectContaining({
      profileId: validProfileId,
    }))
  })
})

describe('authedFetch JWT refresh on 401', () => {
  const validProfileId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  beforeEach(async () => {
    const storage = await import('../storage.js')
    // The session is mutable across the test so that setSession (called by
    // refreshCrunchyrollSession) is visible to subsequent getSession reads.
    let currentSession: { jwt: string; profileId: string; capturedAt: number } | null =
      { jwt: 'stale.jwt', profileId: validProfileId, capturedAt: 0 }
    vi.mocked(storage.getSession).mockImplementation(() => Promise.resolve(currentSession))
    vi.mocked(storage.setSession).mockImplementation((_key, sess) => {
      currentSession = sess as typeof currentSession
      return Promise.resolve()
    })
    vi.mocked(storage.getStoredProfileId).mockResolvedValue(validProfileId)
    vi.mocked(storage.setStoredProfileId).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('refreshes the JWT on 401 and retries the original request with the fresh token', async () => {
    let authCalls = 0
    const seenAuthHeaders: string[] = []

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('https://www.crunchyroll.com/auth/v1/token')) {
        authCalls++
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'fresh.jwt', profile_id: validProfileId }),
        })
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
      seenAuthHeaders.push(auth ?? '')
      // First call uses stale.jwt → 401. Retry uses fresh.jwt → empty seasons OK.
      if (auth === 'Bearer stale.jwt') return Promise.resolve({ ok: false, status: 401 })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) })
    }))

    const catalogs: unknown[] = []
    for await (const c of crunchyrollAdapter.streamCatalogsForShows(['series-1'], () => {})) {
      catalogs.push(c)
    }

    expect(authCalls).toBe(1)
    expect(seenAuthHeaders).toEqual(['Bearer stale.jwt', 'Bearer fresh.jwt'])
    expect(catalogs).toHaveLength(1)
  })

  it('throws CrunchyrollAuthError when the refresh itself also fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('https://www.crunchyroll.com/auth/v1/token')) {
        return Promise.resolve({ ok: false, status: 401 })
      }
      return Promise.resolve({ ok: false, status: 401 })
    }))

    let caught: unknown = null
    try {
      for await (const _c of crunchyrollAdapter.streamCatalogsForShows(['series-1'], () => {})) {
        // drain
      }
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe('CrunchyrollAuthError')
  })

  it('coalesces concurrent 401s from parallel catalog fetches into a single refresh call', async () => {
    let authCalls = 0
    let pendingAuthResolvers: Array<() => void> = []

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('https://www.crunchyroll.com/auth/v1/token')) {
        authCalls++
        // Hold the refresh response until all parallel callers have queued up,
        // so we exercise the in-flight dedup rather than serial calls.
        return new Promise((resolve) => {
          pendingAuthResolvers.push(() => resolve({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'fresh.jwt', profile_id: validProfileId }),
          }))
        })
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization']
      if (auth === 'Bearer stale.jwt') return Promise.resolve({ ok: false, status: 401 })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) })
    }))

    // Fan out 4 series — all hit 401 in parallel; without deduping we'd see 4 refresh calls.
    const drainPromise = (async () => {
      const out: unknown[] = []
      for await (const c of crunchyrollAdapter.streamCatalogsForShows(
        ['s1', 's2', 's3', 's4'],
        () => {},
      )) out.push(c)
      return out
    })()

    // Yield repeatedly so all parallel 401s queue their refresh waits before we resolve.
    for (let i = 0; i < 20 && pendingAuthResolvers.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    pendingAuthResolvers.forEach((resolve) => resolve())
    pendingAuthResolvers = []

    const catalogs = await drainPromise
    expect(authCalls).toBe(1)
    expect(catalogs).toHaveLength(4)
  })
})

describe('crunchyrollAdapter.onRequest stored-profileId fallback', () => {
  const validProfileId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  beforeEach(async () => {
    const storage = await import('../storage.js')
    vi.mocked(storage.getSession).mockResolvedValue(null)
    vi.mocked(storage.setSession).mockResolvedValue(undefined)
    vi.mocked(storage.getStoredProfileId).mockResolvedValue(null)
    vi.mocked(storage.setStoredProfileId).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeDetails(url: string, jwt: string): chrome.webRequest.WebRequestHeadersDetails {
    return {
      url,
      requestHeaders: [{ name: 'Authorization', value: `Bearer ${jwt}` }],
    } as chrome.webRequest.WebRequestHeadersDetails
  }

  it('captures a JWT from a non-profile URL using the durable stored profileId', async () => {
    const { setSession, getStoredProfileId } = await import('../storage.js')
    vi.mocked(getStoredProfileId).mockResolvedValue(validProfileId)

    await crunchyrollAdapter.onRequest!(makeDetails('https://www.crunchyroll.com/auth/v1/refresh', 'recovered.jwt'))

    expect(setSession).toHaveBeenCalledWith('crunchyroll', expect.objectContaining({
      jwt: 'recovered.jwt',
      profileId: validProfileId,
    }))
  })

  it('persists profileId durably whenever a profile-scoped URL is captured', async () => {
    const { setStoredProfileId } = await import('../storage.js')

    await crunchyrollAdapter.onRequest!(makeDetails(
      `https://www.crunchyroll.com/content/v2/${validProfileId}/watch-history`,
      'first.jwt',
    ))

    expect(setStoredProfileId).toHaveBeenCalledWith('crunchyroll', validProfileId)
  })

  it('drops a JWT from a non-profile URL when no session and no stored profileId exist', async () => {
    const { setSession } = await import('../storage.js')
    // Both getSession and getStoredProfileId already default to null in beforeEach.

    await crunchyrollAdapter.onRequest!(makeDetails('https://www.crunchyroll.com/auth/v1/refresh', 'orphan.jwt'))

    expect(setSession).not.toHaveBeenCalled()
  })
})
