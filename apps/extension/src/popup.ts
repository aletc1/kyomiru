import {
  getConfig,
  setConfig,
  getCapturedJwt,
  getCheckpoint,
  getLastSync,
  getSyncState,
  isCapturedJwtExpired,
  isCheckpointStale,
  type ExtensionConfig,
  type SyncState,
  type CapturedJwt,
} from './storage.js'
import { pingKyomiru } from './sync.js'

const CR_PROVIDER = 'crunchyroll'

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element: ${id}`)
  return el
}

function show(el: HTMLElement) { el.classList.remove('hidden') }
function hide(el: HTMLElement) { el.classList.add('hidden') }

function formatRelative(ts: number | null): string {
  if (!ts) return 'never'
  const ago = Date.now() - ts
  const min = Math.round(ago / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}

function appendLog(target: HTMLElement, line: string) {
  target.textContent = (target.textContent ? target.textContent + '\n' : '') + line
  target.scrollTop = target.scrollHeight
}

function setDot(id: string, state: 'ok' | 'err' | 'warn' | 'unknown') {
  const el = $(id)
  el.classList.remove('ok', 'err', 'warn')
  if (state === 'ok') el.classList.add('ok')
  else if (state === 'err') el.classList.add('err')
  else if (state === 'warn') el.classList.add('warn')
}

function renderJwtStatus(jwt: CapturedJwt | null, hasResumableSync: boolean): { ok: boolean } {
  const cta = $('cr-cta')
  const ctaText = $('cr-cta-text')
  hide(cta)

  if (!jwt) {
    $('cr-status').textContent = 'Crunchyroll session not captured'
    setDot('dot-cr', 'err')
    ctaText.textContent = 'Waiting for your Crunchyroll session. Click below and browse any page — we\u2019ll pick it up automatically.'
    show(cta)
    return { ok: false }
  }

  if (isCapturedJwtExpired(jwt)) {
    $('cr-status').textContent = 'Crunchyroll session expired'
    setDot('dot-cr', 'warn')
    ctaText.textContent = hasResumableSync
      ? 'Open Crunchyroll and browse any page — your sync will resume automatically.'
      : 'Session expired. Open Crunchyroll and browse any page to refresh it.'
    show(cta)
    return { ok: false }
  }

  $('cr-status').textContent = `Crunchyroll session captured ${formatRelative(jwt.capturedAt)}`
  setDot('dot-cr', 'ok')
  return { ok: true }
}

function renderSyncState(state: SyncState, opts: { lastSyncLine: string | null; canSync: boolean }) {
  const log = $('sync-log')
  const btn = $('sync-btn') as HTMLButtonElement

  const isRunning = state.status === 'running'
  btn.disabled = isRunning || !opts.canSync
  btn.textContent = isRunning ? 'Syncing…' : 'Sync now'

  const lines = [...state.log]
  if (state.status === 'error' && state.error && !state.log.includes(`Error: ${state.error}`)) {
    lines.push(`Error: ${state.error}`)
  }
  if (!isRunning && state.status === 'idle' && opts.lastSyncLine) {
    lines.push(opts.lastSyncLine)
  }
  log.textContent = lines.join('\n')
  log.scrollTop = log.scrollHeight
}

async function renderMain() {
  hide($('setup'))
  show($('main'))

  const [cfg, jwt, lastSync, state, checkpoint] = await Promise.all([
    getConfig(),
    getCapturedJwt(),
    getLastSync(),
    getSyncState(),
    getCheckpoint(CR_PROVIDER),
  ])

  if (cfg) {
    $('kyomiru-status').textContent = `Kyomiru · ${cfg.userEmail ?? cfg.kyomiruUrl}`
    setDot('dot-kyomiru', cfg.userEmail ? 'ok' : 'warn')
  } else {
    $('kyomiru-status').textContent = 'Not connected'
    setDot('dot-kyomiru', 'err')
  }

  const hasResumableSync = !!(checkpoint && !isCheckpointStale(checkpoint))
  const { ok: jwtOk } = renderJwtStatus(jwt, hasResumableSync)

  let lastSyncLine: string | null = null
  if (hasResumableSync && state.status !== 'running') {
    lastSyncLine = `Sync in progress: ${checkpoint!.seriesDoneIdx}/${checkpoint!.seriesIds.length} shows. Click Sync to resume.`
  } else if (lastSync) {
    lastSyncLine = lastSync.ok
      ? `Last sync: ${formatRelative(lastSync.at)} · ${lastSync.itemsIngested} items (${lastSync.itemsNew} new)`
      : `Last sync failed: ${lastSync.error ?? 'unknown'}`
  }
  renderSyncState(state, { lastSyncLine, canSync: !!cfg && jwtOk })
}

async function renderSetup(prefill?: ExtensionConfig) {
  hide($('main'))
  show($('setup'))

  const urlInput = $('kyomiru-url') as HTMLInputElement
  const tokenInput = $('kyomiru-token') as HTMLInputElement
  urlInput.value = prefill?.kyomiruUrl ?? ''
  tokenInput.value = prefill?.token ?? ''
  $('setup-log').textContent = ''
}

async function handleSave() {
  const urlInput = $('kyomiru-url') as HTMLInputElement
  const tokenInput = $('kyomiru-token') as HTMLInputElement
  const btn = $('save-btn') as HTMLButtonElement
  const log = $('setup-log')

  const rawUrl = urlInput.value.trim().replace(/\/$/, '')
  const token = tokenInput.value.trim()
  if (!rawUrl || !token) {
    appendLog(log, 'Kyomiru URL and token are required.')
    return
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    appendLog(log, 'Invalid URL.')
    return
  }

  btn.disabled = true
  log.textContent = ''

  try {
    const originPattern = `${url.protocol}//${url.host}/*`
    const hasPerm = await chrome.permissions.contains({ origins: [originPattern] })

    // Persist URL/token before the permission prompt — Chrome closes the popup
    // during `chrome.permissions.request`, so anything after it may never run.
    // Saving up front lets `init()` finish verification on the next popup open.
    await setConfig({ kyomiruUrl: rawUrl, token })

    if (!hasPerm) {
      appendLog(log, 'Requesting host permission…')
      const granted = await chrome.permissions.request({ origins: [originPattern] })
      if (!granted) {
        appendLog(log, 'Permission denied — cannot reach Kyomiru.')
        btn.disabled = false
        return
      }
    }

    appendLog(log, 'Verifying token…')
    const me = await pingKyomiru(rawUrl, token)
    appendLog(log, `Connected as ${me.displayName} (${me.email})`)
    await setConfig({ kyomiruUrl: rawUrl, token, userEmail: me.email })
    await renderMain()
  } catch (err) {
    appendLog(log, err instanceof Error ? err.message : String(err))
    btn.disabled = false
  }
}

async function handleOpenCrunchyroll() {
  // /history is user-scoped and triggers a `/content/v2/<profile_id>/watch-history`
  // fetch on load — that's the request our background listener uses to capture
  // both the JWT and the UUID profile id needed for sync.
  await chrome.tabs.create({ url: 'https://www.crunchyroll.com/history' })
}

async function verifySavedConfig(cfg: ExtensionConfig) {
  try {
    const me = await pingKyomiru(cfg.kyomiruUrl, cfg.token)
    await setConfig({ kyomiruUrl: cfg.kyomiruUrl, token: cfg.token, userEmail: me.email })
    await renderMain()
  } catch {
    // Leave config unverified; the user can click Settings to retry.
  }
}

async function handleSync() {
  const btn = $('sync-btn') as HTMLButtonElement
  btn.disabled = true

  const resp = await chrome.runtime.sendMessage({ type: 'sync/start' }).catch(() => null)
  if (!resp?.ok) {
    const log = $('sync-log')
    if (resp?.reason !== 'already-running') {
      appendLog(log, 'Could not start sync. Try reopening the popup.')
    }
  }

  await renderMain()
}

async function handleReconfigure() {
  const cfg = await getConfig()
  await renderSetup(cfg ?? undefined)
}

function wireStorageListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' && area !== 'local') return
    const relevant =
      'syncState' in changes ||
      'capturedJwt' in changes ||
      'lastSync' in changes ||
      `syncCheckpoint:${CR_PROVIDER}` in changes
    if (!relevant) return
    const main = document.getElementById('main')
    if (main && !main.classList.contains('hidden')) {
      void renderMain()
    }
  })
}

async function init() {
  $('save-btn').addEventListener('click', handleSave)
  $('sync-btn').addEventListener('click', handleSync)
  $('reconfigure-btn').addEventListener('click', handleReconfigure)
  $('open-cr-btn').addEventListener('click', handleOpenCrunchyroll)
  wireStorageListener()

  const cfg = await getConfig()
  if (cfg) {
    await renderMain()
    if (!cfg.userEmail) {
      // First save may have been interrupted by the host-permission prompt.
      // Finish verification now that the popup is open again.
      void verifySavedConfig(cfg)
    }
  } else {
    await renderSetup()
  }
}

void init()
