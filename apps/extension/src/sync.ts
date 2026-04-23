import type { IngestBody, IngestResponse } from '@kyomiru/shared/contracts/ingest'
import {
  getCapturedJwt,
  getConfig,
  setLastSync,
  type LastSyncInfo,
} from './storage.js'
import {
  paginateHistory,
  buildIngestPayload,
  fetchCatalogsForSeries,
  uniqueSeriesIdsFromHistory,
  type ProgressEvent,
  type SeriesCatalog,
} from './crunchyroll.js'

const INGEST_CHUNK_SIZE = 1000

export type SyncEvent =
  | { type: 'info'; message: string }
  | { type: 'progress'; page: number; itemsSoFar: number; totalKnown: number | null }
  | { type: 'catalog-progress'; index: number; total: number; seriesId: string; ok: boolean; reason?: string }
  | { type: 'ingest-start'; batch: number; batches: number; items: number }
  | { type: 'ingest-done'; batch: number; itemsIngested: number; itemsNew: number }
  | { type: 'done'; totalIngested: number; totalNew: number }
  | { type: 'error'; message: string }

export async function runSync(
  emit: (ev: SyncEvent) => void,
): Promise<LastSyncInfo> {
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

  emit({ type: 'info', message: 'Fetching Crunchyroll watch history…' })
  const raw = await paginateHistory(jwt.profileId, jwt.jwt, (p: ProgressEvent) => {
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
    const info: LastSyncInfo = { at: Date.now(), itemsIngested: 0, itemsNew: 0, ok: true }
    await setLastSync(info)
    emit({ type: 'done', totalIngested: 0, totalNew: 0 })
    return info
  }

  const uniqueSeries = uniqueSeriesIdsFromHistory(raw)
  emit({ type: 'info', message: `Fetching full catalog for ${uniqueSeries.length} show(s)…` })

  let catalogs: Map<string, SeriesCatalog>
  try {
    catalogs = await fetchCatalogsForSeries(uniqueSeries, jwt.jwt, (ev) => {
      emit({ type: 'catalog-progress', ...ev })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ type: 'info', message: `Catalog fetch failed (${message}) — falling back to history-only payload.` })
    catalogs = new Map()
  }

  const fullPayload = buildIngestPayload(raw, catalogs)
  const totalEpisodes = fullPayload.shows.reduce(
    (sum, s) => sum + s.seasons.reduce((sum2, se) => sum2 + se.episodes.length, 0),
    0,
  )
  emit({
    type: 'info',
    message: `Ready to upload ${fullPayload.items.length} watched item(s), ${fullPayload.shows.length} show(s), ${totalEpisodes} episode(s).`,
  })

  const batches: IngestBody[] = []
  if (fullPayload.items.length <= INGEST_CHUNK_SIZE) {
    batches.push(fullPayload)
  } else {
    for (let i = 0; i < fullPayload.items.length; i += INGEST_CHUNK_SIZE) {
      batches.push({
        items: fullPayload.items.slice(i, i + INGEST_CHUNK_SIZE),
        shows: fullPayload.shows,
      })
    }
  }

  let totalIngested = 0
  let totalNew = 0

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    emit({ type: 'ingest-start', batch: i + 1, batches: batches.length, items: batch.items.length })

    const resp = await fetch(`${cfg.kyomiruUrl.replace(/\/$/, '')}/api/providers/crunchyroll/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(batch),
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      const err = `Ingest failed (batch ${i + 1}): HTTP ${resp.status} ${body}`
      const info: LastSyncInfo = {
        at: Date.now(),
        itemsIngested: totalIngested,
        itemsNew: totalNew,
        ok: false,
        error: err,
      }
      await setLastSync(info)
      emit({ type: 'error', message: err })
      throw new Error(err)
    }

    const data = (await resp.json()) as IngestResponse
    totalIngested += data.itemsIngested
    totalNew += data.itemsNew
    emit({
      type: 'ingest-done',
      batch: i + 1,
      itemsIngested: data.itemsIngested,
      itemsNew: data.itemsNew,
    })
  }

  const info: LastSyncInfo = {
    at: Date.now(),
    itemsIngested: totalIngested,
    itemsNew: totalNew,
    ok: true,
  }
  await setLastSync(info)
  emit({ type: 'done', totalIngested, totalNew })
  return info
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
