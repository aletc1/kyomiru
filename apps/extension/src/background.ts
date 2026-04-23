/// <reference types="chrome" />

import {
  clearCapturedJwt,
  getConfig,
  getCapturedJwt,
  getSyncState,
  setCapturedJwt,
  setSyncState,
  type SyncState,
} from './storage.js'
import { runSync, type SyncEvent } from './sync.js'
import { CrunchyrollAuthError } from './crunchyroll.js'

const SYNC_LOG_MAX_LINES = 200

// Broad match so we pick up refreshed tokens from any Crunchyroll request
// (auth/v1/token, index/v2/*, content/v2/*, etc.), not just watch-history
// endpoints. The listener short-circuits on requests that don't carry a
// Bearer header, so the hot path stays cheap.
const CR_MATCH = '*://*.crunchyroll.com/*'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidProfileId(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Extract the Crunchyroll profile/account id from a URL like
 *   https://www.crunchyroll.com/content/v2/<profile_id>/watch-history?...
 *
 * Only user-scoped UUID segments are accepted — CR also exposes namespace
 * segments under /content/v2/ ("discover", "cms", "accounts", "music", …)
 * which would otherwise be captured and replayed as a bogus profile id,
 * producing 404s at sync time.
 */
function extractProfileId(url: string): string | null {
  const match = url.match(/\/content\/v2\/([^/]+)\//)
  if (!match) return null
  const candidate = match[1]!
  return isValidProfileId(candidate) ? candidate : null
}

// Purge any captured JWT whose profileId isn't a UUID (e.g. "discover" captured
// by an older build of this extension). Forces a fresh capture from a real
// user-scoped request on the next CR visit.
void (async () => {
  const existing = await getCapturedJwt()
  if (existing && !isValidProfileId(existing.profileId)) {
    await clearCapturedJwt()
  }
})()

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization')?.value
    if (!auth?.startsWith('Bearer ')) return
    const jwt = auth.slice('Bearer '.length).trim()
    if (!jwt) return

    void (async () => {
      const profileId = extractProfileId(details.url)
      if (profileId) {
        // Fresh capture from a watch-history-style URL — always refresh both.
        await setCapturedJwt({ jwt, profileId, capturedAt: Date.now() })
        return
      }
      // Not a /content/v2/<id>/... URL. If we already have a profileId stored,
      // reuse it so a refreshed token from /auth/v1/token (etc.) still updates
      // the captured JWT.
      const existing = await getCapturedJwt()
      if (!existing) return
      if (existing.jwt === jwt) return
      await setCapturedJwt({ jwt, profileId: existing.profileId, capturedAt: Date.now() })
    })().catch((err) => {
      console.warn('[Kyomiru] Failed to store captured JWT', err)
    })
  },
  { urls: [CR_MATCH] },
  ['requestHeaders', 'extraHeaders'],
)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Kyomiru] Extension installed. Open crunchyroll.com once to capture a session JWT.')
  // Schedule a daily background sync so the library stays current without
  // requiring the user to open the popup.
  chrome.alarms.create('kyomiru-daily-sync', { periodInMinutes: 24 * 60, delayInMinutes: 60 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'kyomiru-daily-sync') return
  void (async () => {
    const cfg = await getConfig()
    const jwt = await getCapturedJwt()
    if (!cfg || !jwt) return
    void startSync()
  })()
})

function formatEvent(ev: SyncEvent): string | null {
  switch (ev.type) {
    case 'info':
      return ev.message
    case 'progress':
      return `Page ${ev.page} · ${ev.itemsSoFar}${ev.totalKnown ? ` / ${ev.totalKnown}` : ''} items`
    case 'catalog-progress':
      if (!ev.ok) return `Catalog ${ev.index}/${ev.total} · ${ev.seriesId} failed: ${ev.reason ?? 'unknown'}`
      if (ev.index === ev.total || ev.index % 5 === 0) return `Catalog ${ev.index}/${ev.total}…`
      return null
    case 'resolve-done': {
      const needsCatalog = ev.stale + ev.unknown
      if (ev.fresh === 0) return `All ${ev.total} show(s) need catalog fetch`
      if (needsCatalog === 0) return `All ${ev.total} show(s) already known — skipping catalog fetch`
      return `${ev.fresh} show(s) already known (skipping catalog), ${needsCatalog} need catalog`
    }
    case 'ingest-start':
      return `Uploading chunk ${ev.batch} (${ev.shows} show(s), ${ev.items} item(s))…`
    case 'ingest-done':
      return ev.itemsSkipped > 0
        ? `Chunk ${ev.batch} done · ${ev.itemsIngested} ingested (${ev.itemsNew} new, ${ev.itemsSkipped} skipped)`
        : `Chunk ${ev.batch} done · ${ev.itemsIngested} ingested (${ev.itemsNew} new)`
    case 'done':
      return `Sync complete · ${ev.totalIngested} items (${ev.totalNew} new)`
    case 'error':
      return `Error: ${ev.message}`
  }
}

async function startSync(): Promise<void> {
  const existing = await getSyncState()
  if (existing.status === 'running') return

  const startedAt = Date.now()
  const log: string[] = []
  let state: SyncState = { status: 'running', startedAt, log }
  await setSyncState({ ...state, log: [...log] })

  // Serialize writes through a promise chain so fire-and-forget emits
  // don't read-modify-write each other's log.
  let writeChain: Promise<void> = Promise.resolve()
  const scheduleWrite = () => {
    const snapshot: SyncState = { ...state, log: [...log] }
    writeChain = writeChain.then(() => setSyncState(snapshot)).catch(() => {})
  }

  try {
    const result = await runSync((ev) => {
      const line = formatEvent(ev)
      if (line) {
        log.push(line)
        if (log.length > SYNC_LOG_MAX_LINES) log.splice(0, log.length - SYNC_LOG_MAX_LINES)
      }
      // Always write — keeps heartbeatAt fresh so getSyncState can detect
      // a stale "running" state if the service worker dies mid-sync.
      scheduleWrite()
    })
    state = {
      status: 'done',
      startedAt,
      finishedAt: Date.now(),
      log,
      totalIngested: result.itemsIngested,
      totalNew: result.itemsNew,
    }
    scheduleWrite()
    await writeChain
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof CrunchyrollAuthError) {
      await clearCapturedJwt()
    }
    state = { status: 'error', startedAt, finishedAt: Date.now(), log, error: message }
    scheduleWrite()
    await writeChain
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'sync/start') {
    void (async () => {
      const state = await getSyncState()
      if (state.status === 'running') {
        sendResponse({ ok: false, reason: 'already-running' })
        return
      }
      sendResponse({ ok: true })
      void startSync()
    })()
    return true
  }
  return false
})
