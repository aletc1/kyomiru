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
  getCapturedJwt,
  getCheckpoint,
  getConfig,
  isCheckpointStale,
  setCheckpoint,
  setLastSync,
  type CheckpointHistoryItem,
  type LastSyncInfo,
  type SyncCheckpoint,
} from './storage.js'
import {
  buildItemsFromHistory,
  buildShowFromCatalog,
  buildShowFromHistoryFallback,
  collectOrphanHistory,
  groupHistoryBySeries,
  paginateHistory,
  streamCatalogsForSeries,
  uniqueSeriesIdsFromHistory,
  type CrunchyrollHistoryItem,
  type ProgressEvent,
  type SeriesCatalog,
} from './crunchyroll.js'

const PROVIDER_KEY = 'crunchyroll'
const CHUNK_SHOW_COUNT = 10
const RESOLVE_CHUNK_SIZE = 500

export type SyncEvent =
  | { type: 'info'; message: string }
  | { type: 'progress'; page: number; itemsSoFar: number; totalKnown: number | null }
  | { type: 'catalog-progress'; index: number; total: number; seriesId: string; ok: boolean; reason?: string }
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

interface ResolveShowInfo {
  known: boolean
  catalogSyncedAt: string | null
  /** Keys are season numbers (as strings from JSON); values are max known episode number. */
  seasonCoverage: Record<string, number>
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
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return { ok: false, status: resp.status, body: text }
  }
  const data = (await resp.json()) as T
  return { ok: true, data }
}

function toCheckpointHistory(r: CrunchyrollHistoryItem): CheckpointHistoryItem {
  const meta = r.panel?.episode_metadata
  const item: CheckpointHistoryItem = {
    id: r.id,
    date_played: r.date_played,
    playhead: r.playhead,
    fully_watched: r.fully_watched,
  }
  if (r.panel) {
    item.panel = {
      id: r.panel.id,
      ...(meta && {
        episode_metadata: {
          ...(meta.series_id && { series_id: meta.series_id }),
          ...(meta.series_title && { series_title: meta.series_title }),
          ...(meta.season_id && { season_id: meta.season_id }),
          ...(meta.season_number !== undefined && { season_number: meta.season_number }),
          ...(meta.season_title && { season_title: meta.season_title }),
          ...(meta.episode_number !== undefined && { episode_number: meta.episode_number }),
          ...(meta.title && { title: meta.title }),
          ...(typeof meta.duration_ms === 'number' && { duration_ms: meta.duration_ms }),
          ...(meta.episode_air_date && { episode_air_date: meta.episode_air_date }),
          ...(meta.season_slug_title && { season_slug_title: meta.season_slug_title }),
        },
      }),
      ...(r.panel.images && { images: r.panel.images }),
    }
  }
  return item
}

function groupCheckpointBySeries(history: CheckpointHistoryItem[]): Record<string, CheckpointHistoryItem[]> {
  const out: Record<string, CheckpointHistoryItem[]> = {}
  for (const r of history) {
    const id = r.panel?.episode_metadata?.series_id
    if (!id) continue
    ;(out[id] ??= []).push(r)
  }
  return out
}

async function postChunk(api: ApiConfig, body: IngestChunkBody, emit: Emit, batch: number): Promise<IngestChunkResponse> {
  emit({ type: 'ingest-start', batch, items: body.items.length, shows: body.shows.length })
  const res = await apiPost<IngestChunkResponse>(api, `/api/providers/${PROVIDER_KEY}/ingest/chunk`, body)
  if (!res.ok) {
    throw new Error(`Chunk upload failed: HTTP ${res.status} ${res.body}`)
  }
  emit({
    type: 'ingest-done',
    batch,
    itemsIngested: res.data.itemsIngested,
    itemsSkipped: res.data.itemsSkipped,
    itemsNew: res.data.itemsNew,
  })
  return res.data
}

/**
 * Begin or resume a sync run on the server, returning the server-confirmed
 * runId and whether it was resumed. If `resumeRunId` is passed but the server
 * no longer recognizes it, returns null so the caller can fall through to a
 * fresh run.
 */
async function startOrResumeRun(
  api: ApiConfig,
  resumeRunId: string | undefined,
  emit: Emit,
): Promise<{ runId: string; resumed: boolean } | null> {
  const body: IngestStartBody = resumeRunId ? { resumeRunId } : {}
  const res = await apiPost<IngestStartResponse>(api, `/api/providers/${PROVIDER_KEY}/ingest/start`, body)
  if (res.ok) return { runId: res.data.runId, resumed: res.data.resumed }

  if (resumeRunId && res.status === 404) return null

  // Handle the 409 conflict case: server already has a running run we don't
  // know about. Try to close it out with /finalize so the next attempt can
  // start fresh. Surface the info to the user.
  if (res.status === 409) {
    try {
      const parsed = JSON.parse(res.body) as { runId?: string }
      if (parsed.runId) {
        emit({ type: 'info', message: `Closing stale server run ${parsed.runId.slice(0, 8)}…` })
        await apiPost<IngestFinalizeResponse>(
          api,
          `/api/providers/${PROVIDER_KEY}/ingest/finalize`,
          { runId: parsed.runId },
        )
      }
    } catch {
      // Ignore — best-effort cleanup.
    }
    // Retry start once after cleanup.
    const retry = await apiPost<IngestStartResponse>(
      api,
      `/api/providers/${PROVIDER_KEY}/ingest/start`,
      {},
    )
    if (retry.ok) return { runId: retry.data.runId, resumed: false }
    throw new Error(`Start failed after conflict cleanup: HTTP ${retry.status} ${retry.body}`)
  }

  throw new Error(`Start failed: HTTP ${res.status} ${res.body}`)
}

async function finalizeRun(api: ApiConfig, runId: string): Promise<IngestFinalizeResponse> {
  const res = await apiPost<IngestFinalizeResponse>(
    api,
    `/api/providers/${PROVIDER_KEY}/ingest/finalize`,
    { runId },
  )
  if (!res.ok) throw new Error(`Finalize failed: HTTP ${res.status} ${res.body}`)
  return res.data
}

/**
 * Ask the server which series_ids it already has complete Crunchyroll catalog
 * data for, and what the max (season, episode) coverage is for each.
 * Falls back to an empty map on any error so the sync degrades to the old
 * full-catalog path rather than aborting.
 */
async function resolveShows(
  api: ApiConfig,
  seriesIds: string[],
): Promise<Map<string, ResolveShowInfo>> {
  if (seriesIds.length === 0) return new Map()
  const map = new Map<string, ResolveShowInfo>()
  try {
    for (let i = 0; i < seriesIds.length; i += RESOLVE_CHUNK_SIZE) {
      const chunk = seriesIds.slice(i, i + RESOLVE_CHUNK_SIZE)
      const res = await apiPost<{ shows: Array<ResolveShowInfo & { externalShowId: string }> }>(
        api,
        `/api/providers/${PROVIDER_KEY}/ingest/resolve`,
        { externalShowIds: chunk },
      )
      if (!res.ok) return map  // partial results on error — degrade gracefully
      for (const s of res.data.shows) {
        map.set(s.externalShowId, {
          known: s.known,
          catalogSyncedAt: s.catalogSyncedAt,
          seasonCoverage: s.seasonCoverage,
        })
      }
    }
    return map
  } catch {
    return map
  }
}

/**
 * Decide whether a series can use the fast (items-only) path.
 * A series is "fresh" when the server knows it AND every history item for it
 * falls within the per-season coverage the server has already indexed.
 *
 * Checking per-season (rather than only the highest season) prevents silently
 * dropping watched episodes in earlier seasons whose coverage is incomplete.
 */
export function isSeriesFresh(
  info: ResolveShowInfo,
  history: CheckpointHistoryItem[],
): boolean {
  if (!info.known) return false
  if (Object.keys(info.seasonCoverage).length === 0) return false
  for (const item of history) {
    const s = item.panel?.episode_metadata?.season_number
    const e = item.panel?.episode_metadata?.episode_number
    if (s === undefined || e === undefined) continue
    const maxEp = info.seasonCoverage[String(s)]
    if (maxEp === undefined) return false  // season not in coverage at all
    if (e > maxEp) return false             // episode beyond what server knows
  }
  return true
}

/**
 * Partition all series ids into a fast bucket (known + fresh, items-only)
 * and a slow bucket (unknown or stale, needs catalog fetch).
 */
export function classifySeriesIds(
  seriesIds: string[],
  resolveMap: Map<string, ResolveShowInfo>,
  historyBySeries: Record<string, CheckpointHistoryItem[]>,
): { freshIds: string[]; slowIds: string[] } {
  const freshIds: string[] = []
  const slowIds: string[] = []
  for (const id of seriesIds) {
    const info = resolveMap.get(id)
    if (info && isSeriesFresh(info, historyBySeries[id] ?? [])) {
      freshIds.push(id)
    } else {
      slowIds.push(id)
    }
  }
  return { freshIds, slowIds }
}

export async function runSync(emit: Emit): Promise<LastSyncInfo> {
  const cfg = await getConfig()
  if (!cfg) {
    const err = 'Extension is not configured. Open settings first.'
    emit({ type: 'error', message: err })
    throw new Error(err)
  }

  const jwt = await getCapturedJwt()
  if (!jwt) {
    const err = 'No Crunchyroll session detected. Open crunchyroll.com and browse any page, then retry.'
    emit({ type: 'error', message: err })
    throw new Error(err)
  }

  const api: ApiConfig = { url: cfg.kyomiruUrl, token: cfg.token }
  const loaded = await loadOrBuildCheckpoint(api, jwt.profileId, jwt.jwt, emit)
  if (!loaded) {
    const info: LastSyncInfo = { at: Date.now(), itemsIngested: 0, itemsNew: 0, ok: true }
    await setLastSync(info)
    emit({ type: 'done', totalIngested: 0, totalNew: 0 })
    return info
  }
  const checkpoint = loaded

  let batch = 0

  // ── Phase A: items-only chunk for fresh (known) shows ──────────────────────
  if (!checkpoint.freshPhaseDone && checkpoint.freshSeriesIds.length > 0) {
    const freshItems: IngestItem[] = []
    for (const seriesId of checkpoint.freshSeriesIds) {
      const history = checkpoint.historyBySeries[seriesId] ?? []
      freshItems.push(...buildItemsFromHistory(history as CrunchyrollHistoryItem[]))
    }
    if (freshItems.length > 0) {
      emit({
        type: 'info',
        message: `Sending ${freshItems.length} item(s) for ${checkpoint.freshSeriesIds.length} already-known show(s)…`,
      })
      batch++
      await postChunk(api, { runId: checkpoint.runId, items: freshItems, shows: [] }, emit, batch)
    }
    checkpoint.freshPhaseDone = true
    await setCheckpoint(checkpoint)
  }

  // ── Phase B: catalog fetch + chunk upload for slow (new/stale) shows ───────
  const flushBufferedCatalogs = async (bufferedCatalogs: SeriesCatalog[]) => {
    if (bufferedCatalogs.length === 0) return
    const shows: IngestShow[] = []
    const items: IngestItem[] = []

    for (const cat of bufferedCatalogs) {
      const history = checkpoint.historyBySeries[cat.seriesId] ?? []
      shows.push(buildShowFromCatalog(cat, history[0] as CrunchyrollHistoryItem | undefined))
      items.push(...buildItemsFromHistory(history as CrunchyrollHistoryItem[]))
    }

    batch++
    await postChunk(api, { runId: checkpoint.runId, items, shows }, emit, batch)
    checkpoint.seriesDoneIdx += bufferedCatalogs.length
    await setCheckpoint(checkpoint)
  }

  let bufferedCatalogs: SeriesCatalog[] = []

  const flush = async () => {
    await flushBufferedCatalogs(bufferedCatalogs)
    bufferedCatalogs = []
  }

  const remainingSeriesIds = checkpoint.seriesIds.slice(checkpoint.seriesDoneIdx)
  const failedSeriesIds: string[] = []

  if (remainingSeriesIds.length > 0) {
    emit({
      type: 'info',
      message: checkpoint.seriesDoneIdx > 0
        ? `Resuming catalog fetch from ${checkpoint.seriesDoneIdx}/${checkpoint.seriesIds.length}…`
        : `Fetching catalog for ${remainingSeriesIds.length} show(s)…`,
    })

    const indexOffset = checkpoint.seriesDoneIdx
    for await (const catalog of streamCatalogsForSeries(remainingSeriesIds, jwt.jwt, (ev) => {
      emit({
        type: 'catalog-progress',
        index: ev.index + indexOffset,
        total: checkpoint.seriesIds.length,
        seriesId: ev.seriesId,
        ok: ev.ok,
        ...(ev.reason !== undefined && { reason: ev.reason }),
      })
      if (!ev.ok) failedSeriesIds.push(ev.seriesId)
    })) {
      bufferedCatalogs.push(catalog)
      if (bufferedCatalogs.length >= CHUNK_SHOW_COUNT) {
        await flush()
      }
    }

    await flush()
  }

  // Failed-catalog fallback: emit a history-only show for each series whose
  // catalog fetch failed, so at least watched progress lands.
  const fallbackShows: IngestShow[] = []
  const fallbackItems: IngestItem[] = []
  for (const seriesId of failedSeriesIds) {
    const history = checkpoint.historyBySeries[seriesId] ?? []
    const show = buildShowFromHistoryFallback(seriesId, history as CrunchyrollHistoryItem[])
    if (show) {
      fallbackShows.push(show)
      fallbackItems.push(...buildItemsFromHistory(history as CrunchyrollHistoryItem[]))
    }
  }
  if (fallbackShows.length > 0) {
    batch++
    await postChunk(
      api,
      { runId: checkpoint.runId, items: fallbackItems, shows: fallbackShows },
      emit,
      batch,
    )
  }

  // Orphan-items chunk (items without a series_id).
  if (checkpoint.orphans.length > 0) {
    batch++
    await postChunk(
      api,
      {
        runId: checkpoint.runId,
        items: buildItemsFromHistory(checkpoint.orphans as CrunchyrollHistoryItem[]),
        shows: [],
      },
      emit,
      batch,
    )
  }

  const finalized = await finalizeRun(api, checkpoint.runId)
  await clearCheckpoint(PROVIDER_KEY)

  const info: LastSyncInfo = {
    at: Date.now(),
    itemsIngested: finalized.itemsIngested,
    itemsNew: finalized.itemsNew,
    ok: true,
  }
  await setLastSync(info)
  emit({ type: 'done', totalIngested: finalized.itemsIngested, totalNew: finalized.itemsNew })
  return info
}

/**
 * Resume from a valid checkpoint if one exists; otherwise fetch history, ask
 * the server to open a new run, resolve which shows are already known, and
 * persist a fresh checkpoint.
 */
async function loadOrBuildCheckpoint(
  api: ApiConfig,
  profileId: string,
  jwt: string,
  emit: Emit,
): Promise<SyncCheckpoint | null> {
  const existing = await getCheckpoint(PROVIDER_KEY)
  if (existing && !isCheckpointStale(existing)) {
    const resumed = await startOrResumeRun(api, existing.runId, emit)
    if (resumed) {
      const slowRemaining = existing.seriesIds.length - existing.seriesDoneIdx
      const freshRemaining = existing.freshPhaseDone ? 0 : existing.freshSeriesIds.length
      emit({
        type: 'info',
        message: `Resuming sync: ${slowRemaining} show(s) with catalog, ${freshRemaining} known show(s) remaining…`,
      })
      return existing
    }
    // Server forgot about this run — discard checkpoint and start fresh.
    emit({ type: 'info', message: 'Prior sync expired — starting a new one.' })
    await clearCheckpoint(PROVIDER_KEY)
  } else if (existing) {
    emit({ type: 'info', message: 'Discarding stale sync checkpoint.' })
    await clearCheckpoint(PROVIDER_KEY)
  }

  emit({ type: 'info', message: 'Fetching Crunchyroll watch history…' })
  const raw = await paginateHistory(profileId, jwt, (p: ProgressEvent) => {
    if (p.type === 'page') {
      emit({
        type: 'progress',
        page: p.page!,
        itemsSoFar: p.itemsSoFar!,
        totalKnown: p.totalKnown ?? null,
      })
    }
  })

  if (raw.length === 0) {
    emit({ type: 'info', message: 'No watch history to sync.' })
    // Open and immediately finalize an empty run so the server records a
    // success and userServices.lastSyncAt is updated.
    const opened = await startOrResumeRun(api, undefined, emit)
    if (!opened) throw new Error('Failed to open sync run')
    await finalizeRun(api, opened.runId)
    return null
  }

  const opened = await startOrResumeRun(api, undefined, emit)
  if (!opened) throw new Error('Failed to open sync run')

  const allSeriesIds = uniqueSeriesIdsFromHistory(raw)
  const slimHistory = raw.map(toCheckpointHistory)
  const historyBySeries = groupCheckpointBySeries(slimHistory)
  const orphans = collectOrphanHistory(raw).map(toCheckpointHistory)

  // Ask the server which shows it already has catalog coverage for so we can
  // skip redundant catalog fetches in Phase B.
  emit({ type: 'info', message: `Checking server coverage for ${allSeriesIds.length} show(s)…` })
  const resolveMap = await resolveShows(api, allSeriesIds)
  const { freshIds, slowIds } = classifySeriesIds(allSeriesIds, resolveMap, historyBySeries)

  const unknownCount = allSeriesIds.filter((id) => !resolveMap.get(id)?.known).length
  const staleCount = slowIds.length - unknownCount
  emit({ type: 'resolve-done', total: allSeriesIds.length, fresh: freshIds.length, stale: staleCount, unknown: unknownCount })

  const checkpoint: SyncCheckpoint = {
    providerKey: PROVIDER_KEY,
    runId: opened.runId,
    startedAt: Date.now(),
    historyBySeries,
    orphans,
    seriesIds: slowIds,
    seriesDoneIdx: 0,
    freshSeriesIds: freshIds,
    freshPhaseDone: false,
  }
  await setCheckpoint(checkpoint)
  return checkpoint
}

export async function pingKyomiru(
  url: string,
  token: string,
): Promise<{ id: string; email: string; displayName: string }> {
  const resp = await fetch(`${url.replace(/\/$/, '')}/api/extension/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    throw new Error(`Ping failed: HTTP ${resp.status} ${await resp.text().catch(() => '')}`)
  }
  return resp.json() as Promise<{ id: string; email: string; displayName: string }>
}
