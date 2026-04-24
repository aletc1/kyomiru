import type { IngestItem, IngestShow } from '@kyomiru/shared/contracts/ingest'
import { getSession, setSession, clearSession } from '../storage.js'
import type { NetflixSession } from '../storage.js'
import type { ProviderAdapter, SessionStatus, HistoryProgress, CatalogProgress, ShowCatalog, CheckpointItem } from './types.js'

const PAGE_SIZE = 50
const PAGE_DELAY_MS = 200
const SESSION_MAX_AGE_MS = 30 * 60 * 1000
const SYNC_TAB_URL = 'https://www.netflix.com/viewingactivity'

export class NetflixAuthError extends Error {
  status: number
  constructor(status: number) {
    super(`Netflix session expired (HTTP ${status}). Log in to netflix.com, select a profile, then try again.`)
    this.name = 'NetflixAuthError'
    this.status = status
  }
}

/**
 * One row as returned by Netflix's AUI `viewingActivity` endpoint. Episodes
 * carry a parent `series` id and a `seasonDescriptor` string; movies are flat
 * (no series / seasonDescriptor / seriesTitle).
 *
 * Notes on fields Netflix's new endpoint doesn't return (the old
 * `/api/shakti/…/viewingactivity` shape did): `duration`, `bookmark`. The
 * presence of a row in viewing history itself means the user watched enough
 * for Netflix to log it, so we treat every row as `fullyWatched: true` at
 * ingest time.
 */
export interface NetflixViewedItem {
  movieID: number
  /** Composed title, e.g. "Season 2: Pilot" or "Great Movie". */
  title: string
  /** Episode-only title, without the season prefix. Absent for movies. */
  episodeTitle?: string
  /** e.g. "Season 2", "Temporada 2", "2nd Temporada". Absent for movies. */
  seasonDescriptor?: string
  /** Parent series id. Absent for movies. */
  series?: number
  /** Parent series title. Absent for movies. */
  seriesTitle?: string
  /** Epoch milliseconds of the view event. */
  date: number
}

/** Parse "Season 2: Episode 5", "Temporada 2", "2nd Temporada", etc. */
export function parseSeasonDescriptor(descriptor: string | undefined): {
  seasonNumber: number
  episodeNumber: number
} {
  if (!descriptor) return { seasonNumber: 1, episodeNumber: 0 }

  // "Season 2: Episode 5" / "Season 2 Episode 5"
  const fullMatch = descriptor.match(/Season\s+(\d+)[^0-9]+Episode\s+(\d+)/i)
  if (fullMatch) {
    return { seasonNumber: Number(fullMatch[1]), episodeNumber: Number(fullMatch[2]) }
  }

  // "Episode 3"
  const epOnly = descriptor.match(/Episode\s+(\d+)/i)
  if (epOnly) {
    return { seasonNumber: 1, episodeNumber: Number(epOnly[1]) }
  }

  // "Season 2" / "Temporada 2" (Spanish) / "2nd Temporada" (Netflix quirk)
  const seasonOnly =
    descriptor.match(/(?:Season|Temporada|Saison|Stagione|Staffel)\s+(\d+)/i)
    ?? descriptor.match(/(\d+)(?:st|nd|rd|th|e|ème|ª|º)?\s+Temporada/i)
  if (seasonOnly) {
    return { seasonNumber: Number(seasonOnly[1]), episodeNumber: 0 }
  }

  return { seasonNumber: 1, episodeNumber: 0 }
}

// ─── In-tab execution ────────────────────────────────────────────────────────
//
// Netflix's AUI / Shakti endpoints only accept same-origin requests whose
// Referer is a netflix.com page. We open a hidden `/viewingactivity` tab and
// run every fetch inside it via `chrome.scripting.executeScript({ world:
// 'MAIN' })`, so Netflix sees a same-origin call from one of its own pages.

interface SyncTabHandle {
  tabId: number
  /** Set when we created a dedicated window; null when we attached to a user tab. */
  windowId: number | null
}

/**
 * Get a Netflix `/viewingactivity` tab to run the sync in. Prefers an existing
 * one the user already has open (no disruption, no teardown); otherwise
 * creates a minimized window we own. A plain background tab created via
 * `tabs.create` can disappear when the popup that triggered the sync closes,
 * so owning the window keeps the tab alive for the whole run.
 */
async function openNetflixSyncTab(): Promise<SyncTabHandle> {
  const existing = await chrome.tabs.query({ url: '*://*.netflix.com/viewingactivity*' })
  const usable = existing.find((t) => t.id !== undefined)
  if (usable?.id !== undefined) {
    await waitForNetflixRuntime(usable.id)
    return { tabId: usable.id, windowId: null }
  }

  // `state: 'minimized'` would be less intrusive but Chrome heavily throttles
  // JS in minimized windows, and Netflix's SPA never finishes bootstrapping
  // under that throttling. A small, unfocused, normal-state window runs at
  // full speed. It briefly flashes on screen, then closes when sync finishes.
  const win = await chrome.windows.create({
    url: SYNC_TAB_URL,
    focused: false,
    type: 'normal',
    width: 500,
    height: 400,
  })
  const tab = win.tabs?.[0]
  if (!tab?.id || win.id === undefined) {
    throw new Error('Could not open a Netflix window for sync.')
  }
  try {
    await waitForTabComplete(tab.id)
    const updated = await chrome.tabs.get(tab.id)
    const url = updated.url ?? ''
    if (!/\/viewingactivity(\?|$|#)/.test(url)) {
      if (/\/login/.test(url)) throw new NetflixAuthError(401)
      throw new Error(
        `Netflix redirected /viewingactivity to ${url}. ` +
        `Open netflix.com, log in, and select a profile, then try again.`,
      )
    }
    await waitForNetflixRuntime(tab.id)
    return { tabId: tab.id, windowId: win.id }
  } catch (err) {
    await chrome.windows.remove(win.id).catch(() => { /* ignore */ })
    throw err
  }
}

async function closeNetflixSyncTab(handle: SyncTabHandle): Promise<void> {
  if (handle.windowId !== null) {
    await chrome.windows.remove(handle.windowId).catch(() => { /* tab/window may be gone */ })
  }
  // When attached to a user-owned tab we leave it alone.
}

/**
 * Wait until Netflix's SPA has loaded enough of its client state to serve
 * AUI calls. We just check for `BUILD_IDENTIFIER` — anything stricter (e.g.
 * `falcorCache.aui.viewingActivity`) is brittle against Netflix's frequent
 * state-management rewrites. A small fixed delay after that absorbs the
 * extra tick the falcor session needs; the first fetch additionally retries
 * on 404 so we're robust to any remaining bootstrap lag.
 */
async function waitForNetflixRuntime(tabId: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const w = window as unknown as {
          netflix?: { reactContext?: { models?: { serverDefs?: { data?: { BUILD_IDENTIFIER?: string } } } } }
        }
        return Boolean(w.netflix?.reactContext?.models?.serverDefs?.data?.BUILD_IDENTIFIER)
      },
    })
    if (res?.result === true) return
    await delay(300)
  }
  throw new Error('Netflix tab did not finish initializing in time.')
}

function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Timed out waiting for Netflix tab to load.'))
    }, timeoutMs)
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }).catch(() => { /* handled by listener/timeout */ })
  })
}

interface AuiPageResult {
  items: NetflixViewedItem[]
  vhSize: number | null
  profileGuid: string | null
}

/**
 * Fetch one viewing-activity page via Netflix's current AUI pathEvaluator
 * endpoint. Runs inside the Netflix tab so the browser sends it as a
 * same-origin call with cookies and a `/viewingactivity` Referer.
 *
 * The endpoint is a **POST**, not a GET: Netflix expects the profile guid in
 * a form-encoded body (`param={"guid":"…"}`) and two routing headers
 * (`x-netflix.clienttype`, `x-netflix.request.routing`). Called as a GET it
 * returns 404. We read the profile guid from `window.netflix.reactContext`
 * inside the tab.
 */
async function fetchAuiViewingActivity(
  tabId: number,
  page: number,
  pageSize: number,
): Promise<AuiPageResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [page, pageSize],
    func: async (p: number, sz: number): Promise<
      | { ok: true; items: unknown[]; vhSize: number | null; profileGuid: string | null }
      | { ok: false; status: number; reason?: string }
    > => {
      const w = window as unknown as {
        netflix?: {
          reactContext?: { models?: { userInfo?: { data?: { guid?: string } } } }
        }
      }
      const guid = w.netflix?.reactContext?.models?.userInfo?.data?.guid
      if (!guid) return { ok: false, status: 0, reason: 'no-profile-guid' }

      const callPath = encodeURIComponent(JSON.stringify(['aui', 'viewingActivity', p, sz]))
      const url = `/api/aui/pathEvaluator/web/%5E2.0.0?method=call&callPath=${callPath}&falcor_server=0.1.0`
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-netflix.clienttype': 'akira',
          'x-netflix.request.routing': '{"path":"/nq/aui/endpoint/%5E1.0.0-web/pathEvaluator","control_tag":"auinqweb"}',
        },
        body: `param=${encodeURIComponent(JSON.stringify({ guid }))}`,
      })
      if (!resp.ok) return { ok: false, status: resp.status }
      const json = (await resp.json()) as {
        jsonGraph?: {
          aui?: {
            viewingActivity?: {
              value?: {
                vhSize?: number
                profileInfo?: { guid?: string }
                viewedItems?: unknown[]
              }
            }
          }
        }
      }
      const atom = json?.jsonGraph?.aui?.viewingActivity?.value
      return {
        ok: true,
        items: atom?.viewedItems ?? [],
        vhSize: typeof atom?.vhSize === 'number' ? atom.vhSize : null,
        profileGuid: atom?.profileInfo?.guid ?? guid,
      }
    },
  })
  const r = results[0]?.result
  if (!r) throw new Error('Netflix tab did not return a result.')
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new NetflixAuthError(r.status)
    if (r.reason === 'no-profile-guid') {
      throw new Error('Could not read Netflix profile guid from the tab. Make sure a profile is selected.')
    }
    throw new Error(`Netflix HTTP ${r.status} fetching viewing activity page ${page}`)
  }
  return { items: r.items as NetflixViewedItem[], vhSize: r.vhSize, profileGuid: r.profileGuid }
}

/**
 * Run a fetcher, retrying on HTTP 404 with linear backoff. Netflix's AUI
 * endpoint can 404 for a few seconds after the tab loads while the falcor
 * session spins up; once it's live, subsequent fetches succeed consistently.
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 12,
  intervalMs = 800,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const is404 = err instanceof Error && /HTTP 404/.test(err.message)
      if (!is404 || attempt === maxAttempts) throw err
      await delay(intervalMs)
    }
  }
  throw lastErr as Error
}

function isSessionFresh(session: NetflixSession): boolean {
  return Date.now() - session.capturedAt < SESSION_MAX_AGE_MS
}

async function hasNetflixLoginCookie(): Promise<boolean> {
  try {
    // NetflixId is Netflix's primary login cookie. SecureNetflixId is its
    // HTTPS-only sibling; either presence indicates an authenticated session.
    const [a, b] = await Promise.all([
      chrome.cookies.get({ url: 'https://www.netflix.com', name: 'NetflixId' }),
      chrome.cookies.get({ url: 'https://www.netflix.com', name: 'SecureNetflixId' }),
    ])
    return !!(a ?? b)
  } catch {
    return false
  }
}

function viewedItemToIngestItem(item: NetflixViewedItem): IngestItem {
  const { seasonNumber, episodeNumber } = parseSeasonDescriptor(item.seasonDescriptor)
  const isMovie = item.series === undefined

  return {
    externalItemId: String(item.movieID),
    ...(!isMovie && { externalShowId: String(item.series) }),
    watchedAt: new Date(item.date).toISOString(),
    // The AUI endpoint doesn't expose duration or playhead. Rows only exist in
    // viewing history once Netflix decides the user "watched" something, so
    // treat every row as fully watched.
    fullyWatched: true,
    raw: {
      movieID: item.movieID,
      title: item.title,
      episodeTitle: item.episodeTitle,
      seriesTitle: item.seriesTitle,
      seasonDescriptor: item.seasonDescriptor,
      seasonNumber: isMovie ? undefined : seasonNumber,
      episodeNumber: isMovie ? undefined : episodeNumber,
    },
  }
}

function buildNetflixShowFallback(
  showId: string,
  history: NetflixViewedItem[],
): IngestShow | null {
  if (history.length === 0) return null

  const sample = history[0]!
  const title = sample.seriesTitle ?? sample.title ?? showId

  const show: IngestShow = {
    externalId: showId,
    title,
    kind: 'tv',
    seasons: [],
  }

  // Netflix's AUI endpoint gives us a seasonDescriptor ("Temporada 1") but no
  // episode number per row. We bucket rows by season, then assign episode
  // numbers by sorting each bucket's movieIDs ascending — Netflix generally
  // allocates sequential movieIDs to a series' episodes, so this tracks real
  // broadcast order. Worst case a gap produces off-by-N numbering, which is
  // better than every episode colliding on `number: 0` (server dedupes
  // episodes by (show, season, number)).
  const bySeason = new Map<number, NetflixViewedItem[]>()
  for (const item of history) {
    const { seasonNumber } = parseSeasonDescriptor(item.seasonDescriptor)
    const arr = bySeason.get(seasonNumber) ?? []
    if (!arr.some((i) => i.movieID === item.movieID)) arr.push(item)
    bySeason.set(seasonNumber, arr)
  }

  for (const [seasonNumber, items] of Array.from(bySeason.entries()).sort((a, b) => a[0] - b[0])) {
    items.sort((a, b) => a.movieID - b.movieID)
    const season = { number: seasonNumber, episodes: items.map((item, idx) => {
      const episodeName = item.episodeTitle ?? item.title
      return {
        number: idx + 1,
        ...(episodeName && { title: episodeName }),
        externalId: String(item.movieID),
      }
    }) }
    show.seasons.push(season)
  }

  return show
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export const netflixAdapter: ProviderAdapter = {
  key: 'netflix',
  displayName: 'Netflix',
  hostMatch: '*://*.netflix.com/*',
  openSessionUrl: 'https://www.netflix.com/viewingactivity',

  hostMatches(url: URL): boolean {
    return url.hostname.endsWith('.netflix.com') || url.hostname === 'netflix.com'
  },

  // No onRequest: Netflix uses cookies, not a captured Bearer JWT.

  async getSessionStatus(): Promise<SessionStatus> {
    const session = await getSession<NetflixSession>('netflix')
    if (session && isSessionFresh(session)) {
      return {
        kind: 'ok',
        capturedAt: session.capturedAt,
        ...(session.profileGuid && { label: session.profileGuid }),
      }
    }

    // No fresh cached session. Probe netflix.com cookies — if the user is
    // logged in there, sync can pick up the profile on first page fetch.
    // Without this probe the sync button would stay disabled forever.
    const hasCookie = await hasNetflixLoginCookie()
    if (hasCookie) {
      const capturedAt = session?.capturedAt ?? 0
      return {
        kind: 'ok',
        capturedAt,
        ...(session?.profileGuid && { label: session.profileGuid }),
      }
    }

    if (session) return { kind: 'expired', reason: 'Netflix session stale. Log in to netflix.com to refresh it.' }
    return { kind: 'missing', reason: 'No Netflix session. Open netflix.com and log in.' }
  },

  async *paginateHistory(onProgress: (ev: HistoryProgress) => void): AsyncGenerator<NetflixViewedItem> {
    const handle = await openNetflixSyncTab()
    try {
      let page = 1  // AUI viewingActivity is 1-indexed
      let itemsSoFar = 0
      let totalKnown: number | null = null
      let capturedGuid: string | null = null

      while (true) {
        let result: AuiPageResult
        try {
          // First fetch: Netflix sometimes returns 404 for a few seconds after
          // the tab reports "complete" while the falcor session spins up.
          // Retry with short backoff until success.
          result = page === 1
            ? await fetchWithRetry(() => fetchAuiViewingActivity(handle.tabId, page, PAGE_SIZE))
            : await fetchAuiViewingActivity(handle.tabId, page, PAGE_SIZE)
        } catch (err) {
          if (err instanceof NetflixAuthError) await clearSession('netflix')
          throw err
        }

        if (totalKnown === null && result.vhSize !== null) totalKnown = result.vhSize
        if (!capturedGuid && result.profileGuid) {
          capturedGuid = result.profileGuid
          await setSession('netflix', { profileGuid: capturedGuid, capturedAt: Date.now() })
        }

        if (result.items.length === 0) break

        for (const item of result.items) yield item
        itemsSoFar += result.items.length
        onProgress({ page, itemsSoFar, totalKnown })

        if (result.items.length < PAGE_SIZE) break
        if (totalKnown !== null && itemsSoFar >= totalKnown) break

        page++
        await delay(PAGE_DELAY_MS)
      }
    } finally {
      await closeNetflixSyncTab(handle)
    }
  },

  uniqueShowIds(history: unknown[]): string[] {
    const set = new Set<string>()
    for (const item of history as NetflixViewedItem[]) {
      if (item.series !== undefined) set.add(String(item.series))
    }
    return Array.from(set)
  },

  groupHistoryByShow(history: unknown[]): Record<string, unknown[]> {
    const out: Record<string, NetflixViewedItem[]> = {}
    for (const item of history as NetflixViewedItem[]) {
      if (item.series === undefined) continue
      const id = String(item.series)
      ;(out[id] ??= []).push(item)
    }
    return out as Record<string, unknown[]>
  },

  collectOrphans(history: unknown[]): unknown[] {
    return (history as NetflixViewedItem[]).filter((item) => item.series === undefined)
  },

  toCheckpointItem(row: unknown): CheckpointItem {
    const item = row as NetflixViewedItem
    const { seasonNumber, episodeNumber } = parseSeasonDescriptor(item.seasonDescriptor)
    const isMovie = item.series === undefined
    return {
      id: String(item.movieID),
      ...(!isMovie && { showId: String(item.series), seasonNumber, episodeNumber }),
      raw: item,
    }
  },

  buildItemsFromHistory(rows: unknown[]): IngestItem[] {
    return (rows as NetflixViewedItem[]).map(viewedItemToIngestItem)
  },

  buildShowFromHistoryFallback(showId: string, rows: unknown[]): IngestShow | null {
    return buildNetflixShowFallback(showId, rows as NetflixViewedItem[])
  },

  async *streamCatalogsForShows(
    showIds: string[],
    onProgress: (ev: CatalogProgress) => void,
  ): AsyncGenerator<ShowCatalog> {
    // Netflix has no reliable catalog API. Report each show as a failed catalog
    // so the core sync routes it through the history-fallback chunk; TMDb
    // enrichment then fills in the proper catalog on the server.
    for (let i = 0; i < showIds.length; i++) {
      onProgress({ index: i + 1, total: showIds.length, showId: showIds[i]!, ok: false, reason: 'no-catalog' })
    }
  },

  buildShowFromCatalog(_cat: ShowCatalog, _sample?: unknown): IngestShow {
    throw new Error('Netflix adapter does not fetch catalogs')
  },
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
