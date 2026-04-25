/// <reference types="chrome" />

import type { IngestBody, IngestItem, IngestShow, IngestSeason, IngestEpisode } from '@kyomiru/shared/contracts/ingest'
import { getSession, setSession, clearSession, getStoredProfileId, setStoredProfileId } from '../storage.js'
import type { CrunchyrollSession } from '../storage.js'
import type { ProviderAdapter, SessionStatus, HistoryProgress, CatalogProgress, ShowCatalog, CheckpointItem } from './types.js'

const CR_BASE = 'https://www.crunchyroll.com/content/v2'
const CR_AUTH_URL = 'https://www.crunchyroll.com/auth/v1/token'
// Crunchyroll's web client credential (cr_web with empty secret). The token
// endpoint rejects the request without it, even when the etp_rt cookie is valid.
const CR_AUTH_BASIC = 'Basic Y3Jfd2ViOg=='
const PAGE_SIZE = 100
const PAGE_DELAY_MS = 200
const REQUEST_TIMEOUT_MS = 30_000
// Number of series whose catalogs are fetched in parallel.
const CATALOG_CONCURRENCY = 4

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class CrunchyrollAuthError extends Error {
  status: number
  constructor(status: number) {
    super(`Crunchyroll session expired (HTTP ${status}). Open crunchyroll.com — your session will refresh automatically.`)
    this.name = 'CrunchyrollAuthError'
    this.status = status
  }
}

export class CrunchyrollTimeoutError extends Error {
  constructor() {
    super('Crunchyroll request timed out. Check your connection or reopen crunchyroll.com, then try again.')
    this.name = 'CrunchyrollTimeoutError'
  }
}

export interface CrunchyrollPanel {
  id: string
  title?: string
  description?: string
  images?: {
    poster_tall?: Array<Array<{ source: string; width?: number; height?: number }>>
    poster_wide?: Array<Array<{ source: string; width?: number; height?: number }>>
  }
  episode_metadata?: {
    series_id?: string
    series_title?: string
    season_id?: string
    season_number?: number
    season_title?: string
    episode_number?: number
    episode?: string
    title?: string
    duration_ms?: number
    episode_air_date?: string
    season_slug_title?: string
  }
}

export interface CrunchyrollHistoryItem {
  id: string
  date_played: string
  playhead: number
  fully_watched: boolean
  panel?: CrunchyrollPanel
}

interface HistoryPageResponse {
  total?: number
  data?: CrunchyrollHistoryItem[]
}

interface CrunchyrollSeason {
  id: string
  season_number?: number
  title?: string
  season_title?: string
  season_sequence_number?: number
}

interface CrunchyrollSeasonsResponse {
  total?: number
  data?: CrunchyrollSeason[]
}

interface CrunchyrollEpisode {
  id: string
  episode_number?: number
  sequence_number?: number
  title?: string
  episode?: string
  duration_ms?: number
  episode_air_date?: string
  premium_available_date?: string
  season_number?: number
  season_title?: string
}

interface CrunchyrollEpisodesResponse {
  total?: number
  data?: CrunchyrollEpisode[]
}

export interface CrunchyrollSeriesCatalog {
  seriesId: string
  seriesTitle?: string
  seriesDescription?: string
  coverUrl?: string
  seasons: Array<{
    id: string
    number: number
    title?: string
    episodes: CrunchyrollEpisode[]
  }>
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function isValidProfileId(id: string): boolean {
  return UUID_RE.test(id)
}

function extractProfileId(url: string): string | null {
  const match = url.match(/\/content\/v2\/([^/]+)\//)
  if (!match) return null
  const candidate = match[1]!
  return isValidProfileId(candidate) ? candidate : null
}

async function makeAuthedRequest(url: string, jwt: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new CrunchyrollTimeoutError()
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Shared in-flight refresh promise so concurrent 401s collapse onto a single
// token-endpoint call. Without this, parallel catalog fetches could trigger
// many redundant refresh requests and racing session writes.
let inFlightRefresh: Promise<boolean> | null = null

function dedupedRefreshSession(): Promise<boolean> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshCrunchyrollSession()
      .catch(() => false)
      .finally(() => { inFlightRefresh = null })
  }
  return inFlightRefresh
}

/**
 * Authenticated fetch with a single automatic token refresh on 401/403.
 * Uses the browser's existing etp_rt cookie to obtain a fresh JWT without
 * user interaction, so long-running syncs survive token rollovers.
 */
async function authedFetch<T>(url: string, jwt: string): Promise<T> {
  let resp = await makeAuthedRequest(url, jwt)

  if (resp.status === 401 || resp.status === 403) {
    const refreshed = await dedupedRefreshSession()
    if (refreshed) {
      const newSession = await getSession<CrunchyrollSession>('crunchyroll').catch(() => null)
      if (newSession?.jwt) {
        resp = await makeAuthedRequest(url, newSession.jwt)
        if (resp.ok) return (await resp.json()) as T
      }
    }
    throw new CrunchyrollAuthError(resp.status)
  }

  if (!resp.ok) throw new Error(`Crunchyroll HTTP ${resp.status} for ${url}`)
  return (await resp.json()) as T
}

function firstPoster(panel: CrunchyrollPanel | undefined): string | undefined {
  const stacks = panel?.images?.poster_tall ?? panel?.images?.poster_wide ?? []
  const stack = stacks[0]
  if (!stack || stack.length === 0) return undefined
  const sorted = [...stack].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return sorted[0]?.source
}

function historyItemToIngest(r: CrunchyrollHistoryItem): IngestItem {
  const meta = r.panel?.episode_metadata
  const seriesId = meta?.series_id
  const panelId = r.panel?.id ?? r.id

  return {
    externalItemId: panelId,
    ...(seriesId && { externalShowId: seriesId }),
    ...(meta?.season_id && { externalSeasonId: meta.season_id }),
    watchedAt: new Date(r.date_played).toISOString(),
    ...(typeof r.playhead === 'number' && { playheadSeconds: Math.max(0, Math.floor(r.playhead)) }),
    ...(typeof meta?.duration_ms === 'number' && {
      durationSeconds: Math.max(0, Math.floor(meta.duration_ms / 1000)),
    }),
    fullyWatched: Boolean(r.fully_watched),
    raw: {
      panel_id: panelId,
      series_title: meta?.series_title,
      episode_number: meta?.episode_number,
      season_number: meta?.season_number,
    },
  }
}

async function fetchSeriesSeasons(seriesId: string, jwt: string): Promise<CrunchyrollSeason[]> {
  const url = `${CR_BASE}/cms/series/${encodeURIComponent(seriesId)}/seasons?locale=en-US`
  const json = await authedFetch<CrunchyrollSeasonsResponse>(url, jwt)
  return json.data ?? []
}

async function fetchSeasonEpisodes(seasonId: string, jwt: string): Promise<CrunchyrollEpisode[]> {
  const url = `${CR_BASE}/cms/seasons/${encodeURIComponent(seasonId)}/episodes?locale=en-US`
  const json = await authedFetch<CrunchyrollEpisodesResponse>(url, jwt)
  return json.data ?? []
}

async function fetchOneSeriesCatalog(
  seriesId: string,
  jwt: string,
  onSeasonFailure: (reason: string) => void,
): Promise<CrunchyrollSeriesCatalog> {
  const allSeasons = await fetchSeriesSeasons(seriesId, jwt)
  const catalog: CrunchyrollSeriesCatalog = { seriesId, seasons: [] }

  // Fetch all seasons' episode lists in parallel — no artificial delay between them.
  const seasonResults = await Promise.allSettled(
    allSeasons.map((s) => fetchSeasonEpisodes(s.id, jwt).then((eps) => ({ s, eps })))
  )

  for (const result of seasonResults) {
    if (result.status === 'rejected') {
      // Auth errors must bubble up and abort the whole sync.
      if (result.reason instanceof CrunchyrollAuthError) throw result.reason
      onSeasonFailure(result.reason instanceof Error ? result.reason.message : String(result.reason))
      continue
    }
    const { s, eps } = result.value
    const number = s.season_number ?? s.season_sequence_number ?? catalog.seasons.length + 1
    catalog.seasons.push({
      id: s.id,
      number,
      ...(s.title && { title: s.title }),
      episodes: eps,
    })
  }

  return catalog
}

/** Preserved for the back-compat `/ingest` path and tests. */
export async function fetchCatalogsForSeries(
  seriesIds: string[],
  jwt: string,
  onProgress: (ev: CatalogProgress) => void,
): Promise<Map<string, CrunchyrollSeriesCatalog>> {
  const out = new Map<string, CrunchyrollSeriesCatalog>()
  for await (const catalog of streamCatalogsForSeries(seriesIds, jwt, onProgress)) {
    out.set(catalog.showId, catalog.raw as CrunchyrollSeriesCatalog)
  }
  return out
}

async function* streamCatalogsForSeries(
  seriesIds: string[],
  jwt: string,
  onProgress: (ev: CatalogProgress) => void,
): AsyncGenerator<ShowCatalog<CrunchyrollSeriesCatalog>> {
  // Process in windows of CATALOG_CONCURRENCY — each window fires in parallel,
  // auth errors propagate out of Promise.all and terminate the generator.
  for (let i = 0; i < seriesIds.length; i += CATALOG_CONCURRENCY) {
    const window = seriesIds.slice(i, i + CATALOG_CONCURRENCY)
    const windowResults = await Promise.all(
      window.map(async (seriesId, j) => {
        const totalIdx = i + j + 1
        try {
          const catalog = await fetchOneSeriesCatalog(seriesId, jwt, (reason) => {
            onProgress({ index: totalIdx, total: seriesIds.length, showId: seriesId, ok: false, reason })
          })
          onProgress({ index: totalIdx, total: seriesIds.length, showId: seriesId, ok: true })
          return { ok: true as const, seriesId, catalog }
        } catch (err) {
          if (err instanceof CrunchyrollAuthError) throw err
          onProgress({
            index: totalIdx,
            total: seriesIds.length,
            showId: seriesId,
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          })
          return { ok: false as const, seriesId }
        }
      })
    )
    for (const result of windowResults) {
      if (result.ok) yield { showId: result.seriesId, raw: result.catalog }
    }
  }
}

/** Build the ingest payload from watch history + catalog. Used by the back-compat `/ingest` path. */
export function buildIngestPayload(
  raw: CrunchyrollHistoryItem[],
  catalogs: Map<string, CrunchyrollSeriesCatalog>,
): IngestBody {
  const historyBySeries = groupCrHistoryBySeries(raw)
  const showsByExt = new Map<string, IngestShow>()

  for (const [seriesId, cat] of catalogs) {
    const sample = historyBySeries.get(seriesId)?.[0]
    showsByExt.set(seriesId, buildCrShowFromCatalog({ showId: seriesId, raw: cat }, sample))
  }

  for (const [seriesId, history] of historyBySeries) {
    if (showsByExt.has(seriesId)) continue
    const show = buildCrShowFromHistoryFallback(seriesId, history)
    if (show) showsByExt.set(seriesId, show)
  }

  return { items: raw.map(historyItemToIngest), shows: Array.from(showsByExt.values()) }
}

function groupCrHistoryBySeries(raw: CrunchyrollHistoryItem[]): Map<string, CrunchyrollHistoryItem[]> {
  const out = new Map<string, CrunchyrollHistoryItem[]>()
  for (const r of raw) {
    const id = r.panel?.episode_metadata?.series_id
    if (!id) continue
    const bucket = out.get(id)
    if (bucket) bucket.push(r)
    else out.set(id, [r])
  }
  return out
}

function buildCrShowFromCatalog(cat: ShowCatalog<CrunchyrollSeriesCatalog>, sampleHistory?: CrunchyrollHistoryItem): IngestShow {
  const data = cat.raw
  const sampleMeta = sampleHistory?.panel?.episode_metadata
  const title = sampleMeta?.series_title ?? sampleMeta?.season_slug_title ?? data.seriesId
  const cover = firstPoster(sampleHistory?.panel)

  const seasons: IngestSeason[] = data.seasons.map((s) => ({
    number: s.number,
    ...(s.title && { title: s.title }),
    episodes: s.episodes.map<IngestEpisode>((e) => {
      const number = e.episode_number ?? e.sequence_number ?? 0
      return {
        number,
        ...(e.title && { title: e.title }),
        ...(typeof e.duration_ms === 'number' && {
          durationSeconds: Math.max(0, Math.floor(e.duration_ms / 1000)),
        }),
        ...(e.episode_air_date && { airDate: e.episode_air_date.slice(0, 10) }),
        externalId: e.id,
      }
    }),
  }))

  return {
    externalId: data.seriesId,
    title,
    kind: 'anime',
    seasons,
    ...(cover && { coverUrl: cover }),
  }
}

function buildCrShowFromHistoryFallback(
  seriesId: string,
  historyForSeries: CrunchyrollHistoryItem[],
): IngestShow | null {
  if (historyForSeries.length === 0) return null

  const sample = historyForSeries[0]!
  const sampleMeta = sample.panel?.episode_metadata
  const title = sampleMeta?.series_title ?? sampleMeta?.season_slug_title ?? seriesId
  const cover = firstPoster(sample.panel)

  const show: IngestShow = {
    externalId: seriesId,
    title,
    kind: 'anime',
    seasons: [],
    ...(cover && { coverUrl: cover }),
  }

  for (const r of historyForSeries) {
    const meta = r.panel?.episode_metadata
    const panelId = r.panel?.id ?? r.id
    const seasonNum = meta?.season_number ?? 1

    let season = show.seasons.find((s) => s.number === seasonNum)
    if (!season) {
      season = {
        number: seasonNum,
        ...(meta?.season_title && { title: meta.season_title }),
        episodes: [],
      }
      show.seasons.push(season)
    }

    const epNum = meta?.episode_number ?? 0
    if (!season.episodes.find((e) => e.number === epNum && e.externalId === panelId)) {
      season.episodes.push({
        number: epNum,
        ...(meta?.title && { title: meta.title }),
        ...(typeof meta?.duration_ms === 'number' && {
          durationSeconds: Math.max(0, Math.floor(meta.duration_ms / 1000)),
        }),
        ...(meta?.episode_air_date && { airDate: meta.episode_air_date.slice(0, 10) }),
        externalId: panelId,
      })
    }
  }

  return show
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export const crunchyrollAdapter: ProviderAdapter = {
  key: 'crunchyroll',
  displayName: 'Crunchyroll',
  hostMatch: '*://*.crunchyroll.com/*',
  openSessionUrl: 'https://www.crunchyroll.com/history',

  hostMatches(url: URL): boolean {
    return url.hostname.endsWith('.crunchyroll.com') || url.hostname === 'crunchyroll.com'
  },

  async onRequest(details): Promise<void> {
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization')?.value
    if (!auth?.startsWith('Bearer ')) return
    const jwt = auth.slice('Bearer '.length).trim()
    if (!jwt) return

    const profileId = extractProfileId(details.url)
    if (profileId) {
      // Persist profileId durably so it survives a session clear (e.g. after 401).
      await setStoredProfileId('crunchyroll', profileId)
      await setSession('crunchyroll', { jwt, profileId, capturedAt: Date.now() } satisfies CrunchyrollSession)
      return
    }

    const existing = await getSession<CrunchyrollSession>('crunchyroll')
    if (existing?.jwt === jwt) return

    // After a session clear the in-memory session is gone, but the durable profileId
    // lets us recover from any Bearer-bearing request, not just profile-scoped ones.
    const profileIdFallback = existing?.profileId ?? await getStoredProfileId('crunchyroll')
    if (!profileIdFallback) return
    await setSession('crunchyroll', { jwt, profileId: profileIdFallback, capturedAt: Date.now() } satisfies CrunchyrollSession)
  },

  async getSessionStatus(): Promise<SessionStatus> {
    const session = await getSession<CrunchyrollSession>('crunchyroll')
    if (!session) return { kind: 'missing', reason: 'No Crunchyroll session captured. Open crunchyroll.com — we\'ll capture it automatically.' }
    if (!isValidProfileId(session.profileId)) return { kind: 'missing', reason: 'No Crunchyroll session captured. Open crunchyroll.com — we\'ll capture it automatically.' }

    const exp = decodeJwtExp(session.jwt)
    const skewMs = 30_000
    if (exp !== null && exp * 1000 <= Date.now() + skewMs) {
      return { kind: 'expired', reason: 'Session expired. Open crunchyroll.com — your session will refresh automatically.' }
    }

    return { kind: 'ok', capturedAt: session.capturedAt }
  },

  async *paginateHistory(onProgress): AsyncGenerator<CrunchyrollHistoryItem> {
    let page = 1
    let totalKnown: number | null = null

    while (true) {
      // Re-read the session each page so a refresh triggered by authedFetch on
      // a previous page (or by another concurrent sync path) is picked up here.
      const session = await getSession<CrunchyrollSession>('crunchyroll')
      if (!session) throw new Error('No Crunchyroll session. Open crunchyroll.com first.')
      const { jwt, profileId } = session

      const url = `${CR_BASE}/${encodeURIComponent(profileId)}/watch-history?locale=en-US&page=${page}&page_size=${PAGE_SIZE}&preferred_audio_language=en-US`
      const json = await authedFetch<HistoryPageResponse>(url, jwt)
      if (totalKnown === null && typeof json.total === 'number') totalKnown = json.total

      const data = json.data ?? []
      if (data.length === 0) break

      for (const item of data) yield item
      onProgress({ page, itemsSoFar: page * PAGE_SIZE, totalKnown })

      if (data.length < PAGE_SIZE) break
      page++
      await delay(PAGE_DELAY_MS)
    }
  },

  uniqueShowIds(history: unknown[]): string[] {
    const set = new Set<string>()
    for (const r of history as CrunchyrollHistoryItem[]) {
      const id = r.panel?.episode_metadata?.series_id
      if (id) set.add(id)
    }
    return Array.from(set)
  },

  groupHistoryByShow(history: unknown[]): Record<string, unknown[]> {
    const out: Record<string, CrunchyrollHistoryItem[]> = {}
    for (const r of history as CrunchyrollHistoryItem[]) {
      const id = r.panel?.episode_metadata?.series_id
      if (!id) continue
      ;(out[id] ??= []).push(r)
    }
    return out as Record<string, unknown[]>
  },

  collectOrphans(history: unknown[]): unknown[] {
    return (history as CrunchyrollHistoryItem[]).filter((r) => !r.panel?.episode_metadata?.series_id)
  },

  toCheckpointItem(row: unknown): CheckpointItem {
    const r = row as CrunchyrollHistoryItem
    const meta = r.panel?.episode_metadata
    return {
      id: r.panel?.id ?? r.id,
      ...(meta?.series_id !== undefined && { showId: meta.series_id }),
      ...(meta?.season_number !== undefined && { seasonNumber: meta.season_number }),
      ...(meta?.episode_number !== undefined && { episodeNumber: meta.episode_number }),
      raw: {
        id: r.id,
        date_played: r.date_played,
        playhead: r.playhead,
        fully_watched: r.fully_watched,
        panel: r.panel
          ? {
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
          : undefined,
      },
    }
  },

  buildItemsFromHistory(rows: unknown[]): IngestItem[] {
    return (rows as CrunchyrollHistoryItem[]).map(historyItemToIngest)
  },

  buildShowFromHistoryFallback(showId: string, rows: unknown[]): IngestShow | null {
    return buildCrShowFromHistoryFallback(showId, rows as CrunchyrollHistoryItem[])
  },

  async *streamCatalogsForShows(showIds, onProgress): AsyncGenerator<ShowCatalog<CrunchyrollSeriesCatalog>> {
    // Read the latest session just before streaming; authedFetch refreshes it
    // mid-stream if the JWT expires, so we always start with the freshest token.
    const session = await getSession<CrunchyrollSession>('crunchyroll')
    if (!session) throw new Error('No Crunchyroll session.')
    yield* streamCatalogsForSeries(showIds, session.jwt, onProgress)
  },

  buildShowFromCatalog(cat: ShowCatalog, sample?: unknown): IngestShow {
    return buildCrShowFromCatalog(cat as ShowCatalog<CrunchyrollSeriesCatalog>, sample as CrunchyrollHistoryItem | undefined)
  },
}

// ─── Proactive session refresh ────────────────────────────────────────────────

interface CrunchyrollTokenResponse {
  access_token?: string
  profile_id?: string
}

/**
 * Refresh the Crunchyroll session directly from the browser's cookies by
 * calling Crunchyroll's own token endpoint (the same call the web app makes).
 * Returns true if a fresh session was stored, false if cookies are gone/invalid.
 */
export async function refreshCrunchyrollSession(): Promise<boolean> {
  let resp: Response
  try {
    resp = await fetch(CR_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: CR_AUTH_BASIC,
      },
      body: 'grant_type=etp_rt_cookie',
      credentials: 'include',
    })
  } catch {
    return false
  }

  if (!resp.ok) return false

  let data: CrunchyrollTokenResponse
  try {
    data = (await resp.json()) as CrunchyrollTokenResponse
  } catch {
    return false
  }

  const jwt = data.access_token
  if (!jwt) return false

  // Use the profile_id from the token response if it's a valid UUID; otherwise
  // fall back to the last durably-stored one from a previous capture.
  const profileId = (isValidProfileId(data.profile_id ?? '') ? data.profile_id! : null)
    ?? await getStoredProfileId('crunchyroll')
  if (!profileId) return false

  await setStoredProfileId('crunchyroll', profileId)
  await setSession('crunchyroll', { jwt, profileId, capturedAt: Date.now() } satisfies CrunchyrollSession)
  return true
}

// ─── Utilities used by storage.ts and background.ts ──────────────────────────

export function decodeJwtExp(jwt: string): number | null {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1]!
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(base64)) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}
