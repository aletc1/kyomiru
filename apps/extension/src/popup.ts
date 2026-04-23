import {
  getConfig,
  setConfig,
  getCapturedJwt,
  getLastSync,
  type ExtensionConfig,
} from './storage.js'
import { pingKyomiru, runSync, type SyncEvent } from './sync.js'

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

function setDot(id: string, state: 'ok' | 'err' | 'unknown') {
  const el = $(id)
  el.classList.remove('ok', 'err')
  if (state === 'ok') el.classList.add('ok')
  else if (state === 'err') el.classList.add('err')
}

async function renderMain() {
  hide($('setup'))
  show($('main'))

  const cfg = await getConfig()
  const jwt = await getCapturedJwt()
  const lastSync = await getLastSync()

  if (cfg) {
    $('kyomiru-status').textContent = `Kyomiru · ${cfg.userEmail ?? cfg.kyomiruUrl}`
    setDot('dot-kyomiru', 'ok')
  } else {
    $('kyomiru-status').textContent = 'Not connected'
    setDot('dot-kyomiru', 'err')
  }

  if (jwt) {
    $('cr-status').textContent = `Crunchyroll JWT captured ${formatRelative(jwt.capturedAt)}`
    setDot('dot-cr', 'ok')
  } else {
    $('cr-status').textContent = 'Crunchyroll JWT not captured — open crunchyroll.com'
    setDot('dot-cr', 'err')
  }

  const log = $('sync-log')
  if (lastSync) {
    if (lastSync.ok) {
      appendLog(log, `Last sync: ${formatRelative(lastSync.at)} · ${lastSync.itemsIngested} items (${lastSync.itemsNew} new)`)
    } else {
      appendLog(log, `Last sync failed: ${lastSync.error ?? 'unknown'}`)
    }
  }
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
  appendLog(log, 'Requesting host permission…')

  try {
    const originPattern = `${url.protocol}//${url.host}/*`
    const granted = await chrome.permissions.request({ origins: [originPattern] })
    if (!granted) {
      appendLog(log, 'Permission denied — cannot reach Kyomiru.')
      btn.disabled = false
      return
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

async function handleSync() {
  const btn = $('sync-btn') as HTMLButtonElement
  const log = $('sync-log')
  log.textContent = ''
  btn.disabled = true

  const onEvent = (ev: SyncEvent) => {
    switch (ev.type) {
      case 'info':
        appendLog(log, ev.message)
        break
      case 'progress':
        appendLog(log, `Page ${ev.page} · ${ev.itemsSoFar}${ev.totalKnown ? ` / ${ev.totalKnown}` : ''} items`)
        break
      case 'catalog-progress':
        if (!ev.ok) appendLog(log, `Catalog ${ev.index}/${ev.total} · ${ev.seriesId} failed: ${ev.reason ?? 'unknown'}`)
        else if (ev.index === ev.total || ev.index % 5 === 0) appendLog(log, `Catalog ${ev.index}/${ev.total}…`)
        break
      case 'ingest-start':
        appendLog(log, `Uploading batch ${ev.batch}/${ev.batches} (${ev.items} items)…`)
        break
      case 'ingest-done':
        appendLog(log, `Batch ${ev.batch} done · ${ev.itemsIngested} ingested (${ev.itemsNew} new)`)
        break
      case 'done':
        appendLog(log, `Sync complete · ${ev.totalIngested} items (${ev.totalNew} new)`)
        break
      case 'error':
        appendLog(log, `Error: ${ev.message}`)
        break
    }
  }

  try {
    await runSync(onEvent)
  } catch {
    // error already logged via event
  } finally {
    btn.disabled = false
    await renderMain()
  }
}

async function handleReconfigure() {
  const cfg = await getConfig()
  await renderSetup(cfg ?? undefined)
}

async function init() {
  $('save-btn').addEventListener('click', handleSave)
  $('sync-btn').addEventListener('click', handleSync)
  $('reconfigure-btn').addEventListener('click', handleReconfigure)

  const cfg = await getConfig()
  if (cfg) {
    await renderMain()
  } else {
    await renderSetup()
  }
}

void init()
