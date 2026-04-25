import type {
  IngestChunkBody,
  IngestChunkResponse,
  IngestFinalizeResponse,
  IngestItem,
  IngestShow,
  IngestStartBody,
  IngestStartResponse,
} from '@kyomiru/shared/contracts/ingest'
import {
  clearCheckpoint,
  getCheckpoint,
  getConfig,
  isCheckpointStale,
  setCheckpoint,
  setLastSync,
  type LastSyncInfo,
  type SyncCheckpoint,
} from './storage.js'
import { adapters } from './providers/index.js'
import type { CheckpointItem } from './providers/types.js'
import { t } from './i18n.js'

const CHUNK_SHOW_COUNT = 25
const RESOLVE_CHUNK_SIZE = 500
// Maximum items per Phase-A (items-only) chunk, to stay under the 2 MB body limit.
const FRESH_PHASE_CHUNK_SIZE = 500

export type SyncEvent =
  | { type: 'info'; message: string }
  | { type: 'progress'; page: number; itemsSoFar: number; totalKnown: number | null }
  | { type: 'catalog-progress'; index: number; total: number; showId: string; ok: boolean; reason?: string }
  | { type: 'resolve-done'; total: number; fresh: number; stale: number; unknown: number }
  | { type: 'ingest-start'; batch: number; items: number; shows: number }
  | { type: 'ingest-done'; batch: number; itemsIngested: number; itemsSkipped: number; itemsNew: number }
  | { type: 'done'; totalIngested: number; totalNew: number }
  | { type: 'error'; message: string }

type Emit = (ev: SyncEvent) => void

interface ApiConfig {
  url: string
  token: string
}

export class KyomiruAuthError extends Error {
  constructor() { super('Extension token was revoked. Pair the device again.') }
}

interface ResolveShowInfo {
  known: boolean
  catalogSyncedAt: string | null
  seasonCoverage: Record<string, number[]>
}

async function apiPost<T>(api: ApiConfig, path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const resp = await fetch(`${api.url.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api.token}`,
    },
    body: JSON.stringify(body),
  })
  if (resp.status === 401) throw new KyomiruAuthError()
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return { ok: false, status: resp.status, body: text }
  }
  const data = (await resp.json()) as T
  return { ok: true, data }
}

async function postProviderChunk(
  api: ApiConfig,
  providerKey: string,
  body: IngestChunkBody,
  emit: Emit,
  batch: number,
): Promise<IngestChunkResponse> {
  emit({ type: 'ingest-start', batch, items: body.items.length, shows: body.shows.length })
  const res = await apiPost<IngestChunkResponse>(api, `/api/providers/${providerKey}/ingest/chunk`, body)
  if (!res.ok) throw new Error(`Chunk upload failed: HTTP ${res.status} ${res.body}`)
  emit({
    type: 'ingest-done',
    batch,
    itemsIngested: res.data.itemsIngested,
    itemsSkipped: res.data.itemsSkipped,
    itemsNew: res.data.itemsNew,
  })
  return res.data
}

async function startOrResumeRun(
  api: ApiConfig,
  providerKey: string,
  resumeRunId: string | undefined,
  emit: Emit,
): Promise<{ runId: string; resumed: boolean } | null> {
  const body: IngestStartBody = resumeRunId ? { resumeRunId } : {}
  const res = await apiPost<IngestStartResponse>(api, `/api/providers/${providerKey}/ingest/start`, body)
  if (res.ok) return { runId: res.data.runId, resumed: res.data.resumed }

  if (resumeRunId && res.status === 404) return null

  if (res.status === 409) {
    try {
      const parsed = JSON.parse(res.body) as { runId?: string }
      if (parsed.runId) {
        emit({ type: 'info', message: t('ev_closing_stale', { runId: parsed.runId.slice(0, 8) }) })
        await apiPost<IngestFinalizeResponse>(api, `/api/providers/${providerKey}/ingest/finalize`, { runId: parsed.runId })
      }
    } catch {
      // Best-effort cleanup.
    }
    const retry = await apiPost<IngestStartResponse>(api, `/api/providers/${providerKey}/ingest/start`, {})
    if (retry.ok) return { runId: retry.data.runId, resumed: false }
    throw new Error(`Start failed after conflict cleanup: HTTP ${retry.status} ${retry.body}`)
  }

  throw new Error(`Start failed: HTTP ${res.status} ${res.body}`)
}

async function finalizeRun(api: ApiConfig, providerKey: string, runId: string): Promise<IngestFinalizeResponse> {
  const res = await apiPost<IngestFinalizeResponse>(api, `/api/providers/${providerKey}/ingest/finalize`, { runId })
  if (!res.ok) throw new Error(`Finalize failed: HTTP ${res.status} ${res.body}`)
  return res.data
}

async function resolveShows(
  api: ApiConfig,
  providerKey: string,
  showIds: string[],
): Promise<Map<string, ResolveShowInfo>> {
  if (showIds.length === 0) return new Map()
  const map = new Map<string, ResolveShowInfo>()
  try {
    for (let i = 0; i < showIds.length; i += RESOLVE_CHUNK_SIZE) {
      const chunk = showIds.slice(i, i + RESOLVE_CHUNK_SIZE)
      const res = await apiPost<{ shows: Array<ResolveShowInfo & { externalShowId: string }> }>(
        api,
        `/api/providers/${providerKey}/ingest/resolve`,
        { externalShowIds: chunk },
      )
      if (!res.ok) return map
      for (const s of res.data.shows) {
        map.set(s.externalShowId, { known: s.known, catalogSyncedAt: s.catalogSyncedAt, seasonCoverage: s.seasonCoverage })
      }
    }
    return map
  } catch (err) {
    if (err instanceof KyomiruAuthError) throw err
    return map
  }
}

export function isSeriesFresh(
  info: ResolveShowInfo,
  history: CheckpointItem[],
): boolean {
  if (!info.known) return false
  if (Object.keys(info.seasonCoverage).length === 0) return false
  for (const item of history) {
    const s = item.seasonNumber
    const e = item.episodeNumber
    if (s === undefined || e === undefined) continue
    const mapped = info.seasonCoverage[String(s)]
    if (!mapped) return false
    if (!mapped.includes(e)) return false
  }
  return true
}

export function classifyShowIds(
  showIds: string[],
  resolveMap: Map<string, ResolveShowInfo>,
  historyByShow: Record<string, CheckpointItem[]>,
): { freshIds: string[]; slowIds: string[] } {
  const freshIds: string[] = []
  const slowIds: string[] = []
  for (const id of showIds) {
    const info = resolveMap.get(id)
    if (info && isSeriesFresh(info, historyByShow[id] ?? [])) {
      freshIds.push(id)
    } else {
      slowIds.push(id)
    }
  }
  return { freshIds, slowIds }
}

export async function runSync(providerKey: string, emit: Emit): Promise<LastSyncInfo> {
  const adapter = adapters[providerKey]
  if (!adapter) throw new Error(`Unknown provider: ${providerKey}`)

  const cfg = await getConfig()
  if (!cfg) {
    const err = 'Extension is not configured. Open settings first.'
    emit({ type: 'error', message: err })
    throw new Error(err)
  }

  const status = await adapter.getSessionStatus()
  if (status.kind !== 'ok') {
    const err = `No ${adapter.displayName} session detected. Open ${adapter.openSessionUrl} and browse any page, then retry.`
    emit({ type: 'error', message: err })
    throw new Error(err)
  }

  const api: ApiConfig = { url: cfg.kyomiruUrl, token: cfg.token }
  const loaded = await loadOrBuildCheckpoint(api, providerKey, emit)
  if (!loaded) {
    const info: LastSyncInfo = { at: Date.now(), itemsIngested: 0, itemsNew: 0, ok: true }
    await setLastSync(providerKey, info)
    emit({ type: 'done', totalIngested: 0, totalNew: 0 })
    return info
  }
  const checkpoint = loaded

  let batch = 0

  // ── Phase A: items-only chunks for fresh (known) shows ─────────────────────
  if (!checkpoint.freshPhaseDone && checkpoint.freshShowIds.length > 0) {
    const freshItems: IngestItem[] = []
    for (const showId of checkpoint.freshShowIds) {
      const history = checkpoint.historyByShow[showId] ?? []
      freshItems.push(...adapter.buildItemsFromHistory(history.map((c) => c.raw)))
    }
    if (freshItems.length > 0) {
      emit({
        type: 'info',
        message: `Sending ${freshItems.length} item(s) for ${checkpoint.freshShowIds.length} already-known show(s)…`,
      })
      // Sub-chunk to stay within the 2 MB body limit on heavy accounts.
      for (let i = 0; i < freshItems.length; i += FRESH_PHASE_CHUNK_SIZE) {
        batch++
        await postProviderChunk(
          api,
          providerKey,
          { runId: checkpoint.runId, items: freshItems.slice(i, i + FRESH_PHASE_CHUNK_SIZE), shows: [] },
          emit,
          batch,
        )
      }
    }
    checkpoint.freshPhaseDone = true
    await setCheckpoint(checkpoint)
  }

  // ── Phase B: catalog fetch + chunk upload for slow (new/stale) shows ───────
  const flushBufferedCatalogs = async (bufferedShows: Array<{ showId: string; ingestShow: IngestShow }>) => {
    if (bufferedShows.length === 0) return
    const shows: IngestShow[] = []
    const items: IngestItem[] = []

    for (const { showId, ingestShow } of bufferedShows) {
      const history = checkpoint.historyByShow[showId] ?? []
      shows.push(ingestShow)
      items.push(...adapter.buildItemsFromHistory(history.map((c) => c.raw)))
    }

    batch++
    await postProviderChunk(api, providerKey, { runId: checkpoint.runId, items, shows }, emit, batch)
    checkpoint.showDoneIdx += bufferedShows.length
    await setCheckpoint(checkpoint)
  }

  let buffered: Array<{ showId: string; ingestShow: IngestShow }> = []

  const flush = async () => {
    await flushBufferedCatalogs(buffered)
    buffered = []
  }

  const remainingShowIds = checkpoint.showIds.slice(checkpoint.showDoneIdx)
  const failedShowIds: string[] = []

  if (remainingShowIds.length > 0) {
    emit({
      type: 'info',
      message: checkpoint.showDoneIdx > 0
        ? `Resuming catalog fetch from ${checkpoint.showDoneIdx}/${checkpoint.showIds.length}…`
        : `Fetching catalog for ${remainingShowIds.length} show(s)…`,
    })

    const indexOffset = checkpoint.showDoneIdx
    for await (const cat of adapter.streamCatalogsForShows(remainingShowIds, (ev) => {
      emit({
        type: 'catalog-progress',
        index: ev.index + indexOffset,
        total: checkpoint.showIds.length,
        showId: ev.showId,
        ok: ev.ok,
        ...(ev.reason !== undefined && { reason: ev.reason }),
      })
      if (!ev.ok) failedShowIds.push(ev.showId)
    })) {
      const history = checkpoint.historyByShow[cat.showId] ?? []
      const ingestShow = adapter.buildShowFromCatalog(cat, history[0]?.raw)
      buffered.push({ showId: cat.showId, ingestShow })
      if (buffered.length >= CHUNK_SHOW_COUNT) await flush()
    }

    await flush()
  }

  // Failed-catalog fallback: synthesise a history-only show for each series
  // whose catalog fetch failed (or adapters like Netflix that yield no catalogs).
  const fallbackShows: IngestShow[] = []
  const fallbackItems: IngestItem[] = []
  for (const showId of failedShowIds) {
    const history = checkpoint.historyByShow[showId] ?? []
    const show = adapter.buildShowFromHistoryFallback(showId, history.map((c) => c.raw))
    if (show) {
      fallbackShows.push(show)
      fallbackItems.push(...adapter.buildItemsFromHistory(history.map((c) => c.raw)))
    }
  }
  if (fallbackShows.length > 0) {
    batch++
    await postProviderChunk(api, providerKey, { runId: checkpoint.runId, items: fallbackItems, shows: fallbackShows }, emit, batch)
  }

  // Orphan items chunk (items without a show id).
  if (checkpoint.orphans.length > 0) {
    batch++
    await postProviderChunk(
      api,
      providerKey,
      {
        runId: checkpoint.runId,
        items: adapter.buildItemsFromHistory(checkpoint.orphans.map((c) => c.raw)),
        shows: [],
      },
      emit,
      batch,
    )
  }

  const finalized = await finalizeRun(api, providerKey, checkpoint.runId)
  await clearCheckpoint(providerKey)

  const info: LastSyncInfo = {
    at: Date.now(),
    itemsIngested: finalized.itemsIngested,
    itemsNew: finalized.itemsNew,
    ok: true,
  }
  await setLastSync(providerKey, info)
  emit({ type: 'done', totalIngested: finalized.itemsIngested, totalNew: finalized.itemsNew })
  return info
}

async function loadOrBuildCheckpoint(
  api: ApiConfig,
  providerKey: string,
  emit: Emit,
): Promise<SyncCheckpoint | null> {
  const adapter = adapters[providerKey]!

  const existing = await getCheckpoint(providerKey)
  if (existing && !isCheckpointStale(existing)) {
    const resumed = await startOrResumeRun(api, providerKey, existing.runId, emit)
    if (resumed) {
      const slowRemaining = existing.showIds.length - existing.showDoneIdx
      const freshRemaining = existing.freshPhaseDone ? 0 : existing.freshShowIds.length
      emit({
        type: 'info',
        message: `Resuming sync: ${slowRemaining} show(s) with catalog, ${freshRemaining} known show(s) remaining…`,
      })
      return existing
    }
    emit({ type: 'info', message: 'Prior sync expired — starting a new one.' })
    await clearCheckpoint(providerKey)
  } else if (existing) {
    emit({ type: 'info', message: 'Discarding stale sync checkpoint.' })
    await clearCheckpoint(providerKey)
  }

  emit({ type: 'info', message: `Fetching ${adapter.displayName} watch history…` })
  const raw: unknown[] = []
  for await (const item of adapter.paginateHistory((p) => {
    emit({ type: 'progress', page: p.page, itemsSoFar: p.itemsSoFar, totalKnown: p.totalKnown })
  })) {
    raw.push(item)
  }

  if (raw.length === 0) {
    emit({ type: 'info', message: 'No watch history to sync.' })
    const opened = await startOrResumeRun(api, providerKey, undefined, emit)
    if (!opened) throw new Error('Failed to open sync run')
    await finalizeRun(api, providerKey, opened.runId)
    return null
  }

  const opened = await startOrResumeRun(api, providerKey, undefined, emit)
  if (!opened) throw new Error('Failed to open sync run')

  const allShowIds = adapter.uniqueShowIds(raw)
  const groupedRaw = adapter.groupHistoryByShow(raw)
  const orphanRaw = adapter.collectOrphans(raw)

  const historyByShow: Record<string, CheckpointItem[]> = {}
  for (const [showId, rows] of Object.entries(groupedRaw)) {
    historyByShow[showId] = rows.map((r) => adapter.toCheckpointItem(r))
  }
  const orphans = orphanRaw.map((r) => adapter.toCheckpointItem(r))

  emit({ type: 'info', message: `Checking server coverage for ${allShowIds.length} show(s)…` })
  const resolveMap = await resolveShows(api, providerKey, allShowIds)
  const { freshIds, slowIds } = classifyShowIds(allShowIds, resolveMap, historyByShow)

  const unknownCount = allShowIds.filter((id) => !resolveMap.get(id)?.known).length
  const staleCount = slowIds.length - unknownCount
  emit({ type: 'resolve-done', total: allShowIds.length, fresh: freshIds.length, stale: staleCount, unknown: unknownCount })

  const checkpoint: SyncCheckpoint = {
    providerKey,
    runId: opened.runId,
    startedAt: Date.now(),
    historyByShow,
    orphans,
    showIds: slowIds,
    showDoneIdx: 0,
    freshShowIds: freshIds,
    freshPhaseDone: false,
  }
  await setCheckpoint(checkpoint)
  return checkpoint
}

export async function pingKyomiru(
  url: string,
  token: string,
): Promise<{ id: string; email: string; displayName: string; preferredLocale: string | null }> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/api/extension/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (resp.status === 401) throw new KyomiruAuthError()
  if (!resp.ok) {
    throw new Error(`Ping failed: HTTP ${resp.status} ${await resp.text().catch(() => '')}`)
  }
  const data = (await resp.json()) as {
    id: string
    email: string
    displayName: string
    preferredLocale?: string | null
  }
  return { ...data, preferredLocale: data.preferredLocale ?? null }
}
