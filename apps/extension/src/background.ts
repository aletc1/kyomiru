/// <reference types="chrome" />

import {
  clearSession,
  clearConfig,
  setAuthError,
  getConfig,
  getSyncState,
  setSyncState,
  type SyncState,
} from './storage.js'
import { runSync, KyomiruAuthError, type SyncEvent } from './sync.js'
import { allAdapters } from './providers/index.js'
import { CrunchyrollAuthError } from './providers/crunchyroll.js'
import { NetflixAuthError } from './providers/netflix.js'

const SYNC_LOG_MAX_LINES = 200

// Register a webRequest listener for each adapter that implements onRequest.
for (const adapter of allAdapters()) {
  if (!adapter.onRequest) continue
  const bound = adapter.onRequest.bind(adapter)
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => { void bound(details).catch((err) => { console.warn(`[Kyomiru] ${adapter.key} onRequest error`, err) }) },
    { urls: [adapter.hostMatch] },
    ['requestHeaders', 'extraHeaders'],
  )
}

// On first install, purge any legacy `capturedJwt` key left by older builds.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.remove('capturedJwt').catch(() => {})
  console.log('[Kyomiru] Extension installed. Open a supported streaming site to capture a session.')
  chrome.alarms.create('kyomiru-daily-sync', { periodInMinutes: 24 * 60, delayInMinutes: 60 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'kyomiru-daily-sync') return
  void (async () => {
    const cfg = await getConfig()
    if (!cfg) return
    for (const adapter of allAdapters()) {
      const status = await adapter.getSessionStatus()
      if (status.kind === 'ok') void startSync(adapter.key)
    }
  })()
})

function formatEvent(ev: SyncEvent): string | null {
  switch (ev.type) {
    case 'info':
      return ev.message
    case 'progress':
      return `Page ${ev.page} · ${ev.itemsSoFar}${ev.totalKnown ? ` / ${ev.totalKnown}` : ''} items`
    case 'catalog-progress':
      if (!ev.ok) return `Catalog ${ev.index}/${ev.total} · ${ev.showId} failed: ${ev.reason ?? 'unknown'}`
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

async function startSync(providerKey: string): Promise<void> {
  const existing = await getSyncState(providerKey)
  if (existing.status === 'running') return

  const startedAt = Date.now()
  const log: string[] = []
  let state: SyncState = { status: 'running', startedAt, log }
  await setSyncState(providerKey, { ...state, log: [...log] })

  let writeChain: Promise<void> = Promise.resolve()
  const scheduleWrite = () => {
    const snapshot: SyncState = { ...state, log: [...log] }
    writeChain = writeChain.then(() => setSyncState(providerKey, snapshot)).catch(() => {})
  }

  try {
    const result = await runSync(providerKey, (ev) => {
      const line = formatEvent(ev)
      if (line) {
        log.push(line)
        if (log.length > SYNC_LOG_MAX_LINES) log.splice(0, log.length - SYNC_LOG_MAX_LINES)
      }
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
    if (err instanceof KyomiruAuthError) {
      await clearConfig()
      await setAuthError(true)
    }
    if (err instanceof CrunchyrollAuthError) await clearSession('crunchyroll')
    if (err instanceof NetflixAuthError) await clearSession('netflix')
    state = { status: 'error', startedAt, finishedAt: Date.now(), log, error: message }
    scheduleWrite()
    await writeChain
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const providerKey = typeof msg?.providerKey === 'string' ? msg.providerKey : null

  if (msg?.type === 'sync/start' && providerKey) {
    void (async () => {
      const state = await getSyncState(providerKey)
      if (state.status === 'running') {
        sendResponse({ ok: false, reason: 'already-running' })
        return
      }
      sendResponse({ ok: true })
      void startSync(providerKey)
    })()
    return true
  }
  return false
})
