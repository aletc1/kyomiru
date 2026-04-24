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
import { CrunchyrollAuthError, refreshCrunchyrollSession } from './providers/crunchyroll.js'
import { NetflixAuthError } from './providers/netflix.js'
import { initLocale, t } from './i18n.js'

const SYNC_LOG_MAX_LINES = 200
const SESSION_REFRESH_THROTTLE_MS = 30_000

// ─── Proactive session refresh on navigation ──────────────────────────────────

// Throttle map: providerKey → timestamp of last refresh attempt.
const lastRefreshAttempt = new Map<string, number>()

// When the user loads any Crunchyroll page, check whether the session is stale
// and refresh it via the browser's existing cookies — no page interaction needed.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  const url = tab.url
  if (!url) return
  let parsed: URL
  try { parsed = new URL(url) } catch { return }

  const adapter = allAdapters().find((a) => a.hostMatches(parsed))
  if (!adapter || adapter.key !== 'crunchyroll') return

  void (async () => {
    const now = Date.now()
    const lastAttempt = lastRefreshAttempt.get(adapter.key) ?? 0
    if (now - lastAttempt < SESSION_REFRESH_THROTTLE_MS) return
    // Stamp before any await so two concurrent navigations can't both pass the
    // throttle check and double-fire the refresh.
    lastRefreshAttempt.set(adapter.key, now)

    const status = await adapter.getSessionStatus()
    if (status.kind === 'ok') return

    await refreshCrunchyrollSession()
  })()
})

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
      return t('ev_page_progress', {
        page: ev.page,
        items: ev.itemsSoFar,
        total: ev.totalKnown ? ` / ${ev.totalKnown}` : '',
      })
    case 'catalog-progress':
      if (!ev.ok) return t('ev_catalog_failed', { i: ev.index, total: ev.total, showId: ev.showId, reason: ev.reason ?? 'unknown' })
      if (ev.index === ev.total || ev.index % 5 === 0) return t('ev_catalog_progress', { i: ev.index, total: ev.total })
      return null
    case 'resolve-done': {
      const needsCatalog = ev.stale + ev.unknown
      if (ev.fresh === 0) return t('ev_resolve_all_unknown', { n: ev.total })
      if (needsCatalog === 0) return t('ev_resolve_all_known', { n: ev.total })
      return t('ev_resolve_mixed', { fresh: ev.fresh, needs: needsCatalog })
    }
    case 'ingest-start':
      return t('ev_uploading_chunk', { batch: ev.batch, shows: ev.shows, items: ev.items })
    case 'ingest-done':
      return ev.itemsSkipped > 0
        ? t('ev_chunk_done_skipped', { batch: ev.batch, ingested: ev.itemsIngested, newCount: ev.itemsNew, skipped: ev.itemsSkipped })
        : t('ev_chunk_done', { batch: ev.batch, ingested: ev.itemsIngested, newCount: ev.itemsNew })
    case 'done':
      return t('ev_done', { items: ev.totalIngested, newCount: ev.totalNew })
    case 'error':
      return t('ev_error', { message: ev.message })
  }
}

async function startSync(providerKey: string): Promise<void> {
  const existing = await getSyncState(providerKey)
  if (existing.status === 'running') return

  const cfg = await getConfig()
  initLocale(cfg?.userPreferredLocale ?? null)

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
