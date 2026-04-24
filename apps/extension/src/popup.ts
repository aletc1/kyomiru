import {
  getConfig,
  setConfig,
  clearConfig,
  getAuthError,
  setAuthError,
  getCheckpoint,
  getLastSync,
  getSyncState,
  isCheckpointStale,
  type ExtensionConfig,
  type SyncState,
} from './storage.js'
import { pingKyomiru, KyomiruAuthError } from './sync.js'
import { allAdapters, adapterForTab } from './providers/index.js'
import type { ProviderAdapter, SessionStatus } from './providers/types.js'
import { initLocale, t } from './i18n.js'

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element: ${id}`)
  return el
}

function show(el: HTMLElement) { el.classList.remove('hidden') }
function hide(el: HTMLElement) { el.classList.add('hidden') }

function formatRelative(ts: number | null): string {
  if (!ts) return t('fmt_never')
  const ago = Date.now() - ts
  const min = Math.round(ago / 60_000)
  if (min < 1) return t('fmt_just_now')
  if (min < 60) return t('fmt_minutes_ago', { n: min })
  const hr = Math.round(min / 60)
  if (hr < 24) return t('fmt_hours_ago', { n: hr })
  const d = Math.round(hr / 24)
  return t('fmt_days_ago', { n: d })
}

function appendLog(target: HTMLElement, line: string) {
  target.textContent = (target.textContent ? target.textContent + '\n' : '') + line
  target.scrollTop = target.scrollHeight
}

function setDot(el: HTMLElement, state: 'ok' | 'err' | 'warn' | 'unknown') {
  el.classList.remove('ok', 'err', 'warn')
  if (state === 'ok') el.classList.add('ok')
  else if (state === 'err') el.classList.add('err')
  else if (state === 'warn') el.classList.add('warn')
}

function applyStaticChrome() {
  document.title = t('title')
  const setText = (id: string, key: Parameters<typeof t>[0]) => {
    const el = document.getElementById(id)
    if (el) el.textContent = t(key)
  }
  setText('static-title', 'title')
  setText('revoked-banner', 'banner_revoked')
  setText('connect-heading', 'connect_heading')
  setText('label-url', 'label_server_url')
  setText('label-token', 'label_token')
  setText('token-hint', 'token_hint')
  setText('save-btn', 'btn_connect')
  setText('reconfigure-btn', 'btn_settings')
}

// ─── Per-provider card ────────────────────────────────────────────────────────

function buildProviderCard(adapter: ProviderAdapter): {
  card: HTMLDivElement
  dotEl: HTMLSpanElement
  statusEl: HTMLSpanElement
  ctaEl: HTMLDivElement
  ctaTextEl: HTMLDivElement
  openBtn: HTMLButtonElement
  syncBtn: HTMLButtonElement
  logEl: HTMLDivElement
} {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset['providerKey'] = adapter.key

  const dotEl = document.createElement('span')
  dotEl.className = 'dot'

  const statusEl = document.createElement('span')
  statusEl.textContent = t('status_unknown', { provider: adapter.displayName })

  const statusLine = document.createElement('div')
  statusLine.className = 'status-line'
  statusLine.appendChild(dotEl)

  const nameEl = document.createElement('span')
  nameEl.className = 'provider-name'
  nameEl.textContent = adapter.displayName
  statusLine.appendChild(nameEl)

  statusLine.appendChild(document.createTextNode(' — '))
  statusLine.appendChild(statusEl)
  card.appendChild(statusLine)

  const ctaTextEl = document.createElement('div')
  const ctaEl = document.createElement('div')
  ctaEl.className = 'cta hidden'
  ctaEl.appendChild(ctaTextEl)

  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.style.cssText = 'margin-top:6px; padding:4px 10px; font-size:12px;'
  openBtn.textContent = t('btn_open_provider', { provider: adapter.displayName })
  ctaEl.appendChild(openBtn)
  card.appendChild(ctaEl)

  const syncBtns = document.createElement('div')
  syncBtns.className = 'btns'
  syncBtns.style.marginTop = '8px'

  const syncBtn = document.createElement('button')
  syncBtn.className = 'primary'
  syncBtn.textContent = t('btn_sync_now')
  syncBtns.appendChild(syncBtn)
  card.appendChild(syncBtns)

  const logEl = document.createElement('div')
  logEl.className = 'log'
  logEl.style.marginTop = '8px'
  card.appendChild(logEl)

  return { card, dotEl, statusEl, ctaEl, ctaTextEl, openBtn, syncBtn, logEl }
}

async function renderProviderCard(
  adapter: ProviderAdapter,
  elements: ReturnType<typeof buildProviderCard>,
): Promise<void> {
  const { dotEl, statusEl, ctaEl, ctaTextEl, openBtn, syncBtn, logEl } = elements

  const [sessionStatus, lastSync, syncState, checkpoint] = await Promise.all([
    adapter.getSessionStatus(),
    getLastSync(adapter.key),
    getSyncState(adapter.key),
    getCheckpoint(adapter.key),
  ])

  renderSessionStatus(adapter, sessionStatus, dotEl, statusEl, ctaEl, ctaTextEl, openBtn)

  const sessionOk = sessionStatus.kind === 'ok'
  const hasResumableSync = !!(checkpoint && !isCheckpointStale(checkpoint))
  const isRunning = syncState.status === 'running'

  syncBtn.disabled = isRunning || !sessionOk
  syncBtn.textContent = isRunning ? t('btn_syncing') : t('btn_sync_now')

  const lines = [...syncState.log]
  if (syncState.status === 'error' && syncState.error && !syncState.log.includes(`Error: ${syncState.error}`)) {
    lines.push(t('ev_error', { message: syncState.error }))
  }
  if (!isRunning && syncState.status === 'idle') {
    if (hasResumableSync && checkpoint) {
      lines.push(t('sync_in_progress', { done: checkpoint.showDoneIdx, total: checkpoint.showIds.length }))
    } else if (lastSync) {
      lines.push(
        lastSync.ok
          ? t('last_sync_summary', { rel: formatRelative(lastSync.at), items: lastSync.itemsIngested, newCount: lastSync.itemsNew })
          : t('last_sync_failed', { error: lastSync.error ?? 'unknown' }),
      )
    }
  }
  logEl.textContent = lines.join('\n')
  logEl.scrollTop = logEl.scrollHeight
}

function renderSessionStatus(
  adapter: ProviderAdapter,
  status: SessionStatus,
  dotEl: HTMLSpanElement,
  statusEl: HTMLSpanElement,
  ctaEl: HTMLDivElement,
  ctaTextEl: HTMLDivElement,
  openBtn: HTMLButtonElement,
) {
  hide(ctaEl)

  if (status.kind === 'missing') {
    statusEl.textContent = t('status_not_captured', { provider: adapter.displayName })
    setDot(dotEl, 'err')
    ctaTextEl.textContent = t('open_provider_cta', { provider: adapter.displayName })
    openBtn.textContent = t('btn_open_provider', { provider: adapter.displayName })
    show(ctaEl)
    return
  }

  if (status.kind === 'expired') {
    statusEl.textContent = t('status_expired', { provider: adapter.displayName })
    setDot(dotEl, 'warn')
    ctaTextEl.textContent = status.reason
    openBtn.textContent = t('btn_open_provider', { provider: adapter.displayName })
    show(ctaEl)
    return
  }

  statusEl.textContent = status.capturedAt > 0
    ? t('status_captured', { rel: formatRelative(status.capturedAt) })
    : t('status_ready')
  setDot(dotEl, 'ok')
}

// ─── Main render ──────────────────────────────────────────────────────────────

type CardEntry = { adapter: ProviderAdapter; elements: ReturnType<typeof buildProviderCard> }
const cardEntries: CardEntry[] = []

async function renderMain(): Promise<void> {
  hide($('setup'))
  show($('main'))

  const cfg = await getConfig()
  if (cfg) {
    $('kyomiru-status').textContent = t('kyomiru_label', { ident: cfg.userEmail ?? cfg.kyomiruUrl })
    const dot = $('dot-kyomiru')
    dot.classList.remove('ok', 'err', 'warn')
    dot.classList.add(cfg.userEmail ? 'ok' : 'warn')
  } else {
    $('kyomiru-status').textContent = t('not_connected')
    const dot = $('dot-kyomiru')
    dot.classList.remove('ok', 'warn')
    dot.classList.add('err')
  }

  for (const { adapter, elements } of cardEntries) {
    await renderProviderCard(adapter, elements)
  }
}

async function buildProviderCards(): Promise<void> {
  let focusedKey: string | null = null
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const focused = adapterForTab(tab?.url)
    focusedKey = focused?.key ?? null
  } catch {
    // tabs API not available in some contexts — fall back to showing all.
  }

  const container = $('providers-container')
  container.innerHTML = ''
  cardEntries.length = 0

  const ordered = focusedKey
    ? [
        ...allAdapters().filter((a) => a.key === focusedKey),
        ...allAdapters().filter((a) => a.key !== focusedKey),
      ]
    : allAdapters()

  for (const adapter of ordered) {
    const elements = buildProviderCard(adapter)
    elements.openBtn.addEventListener('click', () => {
      void chrome.tabs.create({ url: adapter.openSessionUrl })
    })
    elements.syncBtn.addEventListener('click', () => { void handleSync(adapter.key, elements.syncBtn) })
    container.appendChild(elements.card)
    cardEntries.push({ adapter, elements })
  }
}

async function renderSetup(prefill?: ExtensionConfig): Promise<void> {
  hide($('main'))
  show($('setup'))
  const urlInput = $('kyomiru-url') as HTMLInputElement
  const tokenInput = $('kyomiru-token') as HTMLInputElement
  urlInput.value = prefill?.kyomiruUrl ?? ''
  tokenInput.value = prefill?.token ?? ''
  $('setup-log').textContent = ''
  const wasRevoked = await getAuthError()
  if (wasRevoked) {
    show($('revoked-banner'))
  } else {
    hide($('revoked-banner'))
  }
}

async function handleSave(): Promise<void> {
  const urlInput = $('kyomiru-url') as HTMLInputElement
  const tokenInput = $('kyomiru-token') as HTMLInputElement
  const btn = $('save-btn') as HTMLButtonElement
  const log = $('setup-log')

  const rawUrl = urlInput.value.trim().replace(/\/$/, '')
  const token = tokenInput.value.trim()
  if (!rawUrl || !token) {
    appendLog(log, t('url_token_required'))
    return
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    appendLog(log, t('invalid_url'))
    return
  }

  btn.disabled = true
  log.textContent = ''

  try {
    const originPattern = `${url.protocol}//${url.host}/*`
    const hasPerm = await chrome.permissions.contains({ origins: [originPattern] })

    await setConfig({ kyomiruUrl: rawUrl, token })

    if (!hasPerm) {
      appendLog(log, t('requesting_perm'))
      const granted = await chrome.permissions.request({ origins: [originPattern] })
      if (!granted) {
        appendLog(log, t('permission_denied'))
        btn.disabled = false
        return
      }
    }

    appendLog(log, t('verifying_token'))
    const me = await pingKyomiru(rawUrl, token)
    if (me.preferredLocale) initLocale(me.preferredLocale)
    appendLog(log, t('connected_as', { name: me.displayName, email: me.email }))
    await setConfig({ kyomiruUrl: rawUrl, token, userEmail: me.email, userPreferredLocale: me.preferredLocale })
    await setAuthError(false)
    applyStaticChrome()
    await buildProviderCards()
    await renderMain()
  } catch (err) {
    appendLog(log, err instanceof Error ? err.message : String(err))
    btn.disabled = false
  }
}

async function handleSync(providerKey: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true

  const resp = await chrome.runtime.sendMessage({ type: 'sync/start', providerKey }).catch(() => null)
  if (!resp?.ok) {
    const card = cardEntries.find((e) => e.adapter.key === providerKey)
    if (card && resp?.reason !== 'already-running') {
      card.elements.logEl.textContent = t('could_not_start')
    }
  }

  await renderMain()
}

async function handleReconfigure(): Promise<void> {
  const cfg = await getConfig()
  await renderSetup(cfg ?? undefined)
}

function wireStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' && area !== 'local') return

    const relevant = Object.keys(changes).some((key) =>
      key.startsWith('syncState:') ||
      key.startsWith('capturedSession:') ||
      key.startsWith('lastSync:') ||
      key.startsWith('syncCheckpoint:'),
    )
    if (!relevant) return

    const mainEl = document.getElementById('main')
    if (mainEl && !mainEl.classList.contains('hidden')) {
      void renderMain()
    }
  })
}

async function verifySavedConfig(cfg: ExtensionConfig): Promise<void> {
  try {
    const me = await pingKyomiru(cfg.kyomiruUrl, cfg.token)
    if (me.preferredLocale) initLocale(me.preferredLocale)
    await setConfig({ kyomiruUrl: cfg.kyomiruUrl, token: cfg.token, userEmail: me.email, userPreferredLocale: me.preferredLocale })
    applyStaticChrome()
    await renderMain()
  } catch (err) {
    if (err instanceof KyomiruAuthError) {
      await clearConfig()
      await setAuthError(true)
      await renderSetup()
    }
    // Otherwise leave config unverified; user can click Settings to retry.
  }
}

async function init(): Promise<void> {
  const cfg = await getConfig()
  initLocale(cfg?.userPreferredLocale ?? null)
  applyStaticChrome()

  $('save-btn').addEventListener('click', () => { void handleSave() })
  $('reconfigure-btn').addEventListener('click', () => { void handleReconfigure() })
  wireStorageListener()

  await buildProviderCards()

  if (cfg) {
    await renderMain()
    if (!cfg.userEmail) {
      void verifySavedConfig(cfg)
    }
  } else {
    await renderSetup()
  }
}

void init()
