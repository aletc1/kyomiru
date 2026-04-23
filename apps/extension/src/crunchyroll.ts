import type { IngestBody, IngestItem, IngestShow, IngestSeason, IngestEpisode } from '@kyomiru/shared/contracts/ingest'

const CR_BASE = 'https://www.crunchyroll.com/content/v2'
const PAGE_SIZE = 100
const PAGE_DELAY_MS = 200

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

export interface ProgressEvent {
  type: 'page' | 'done' | 'error'
  page?: number
  itemsSoFar?: number
  totalKnown?: number | null
  error?: string
}

// ─── Catalog types (seasons/episodes) ───────────────────────────────────────

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

export interface SeriesCatalog {
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

async function authedFetch<T>(url: string, jwt: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  })
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Crunchyroll auth expired (HTTP ${resp.status}). Reload crunchyroll.com and try again.`)
  }
  if (!resp.ok) {
    throw new Error(`Crunchyroll HTTP ${resp.status} for ${url}`)
  }
  return (await resp.json()) as T
}

export async function paginateHistory(
  profileId: string,
  jwt: string,
  onProgress: (ev: ProgressEvent) => void,
): Promise<CrunchyrollHistoryItem[]> {
  const all: CrunchyrollHistoryItem[] = []
  let page = 1
  let totalKnown: number | null = null

  while (true) {
    const url = `${CR_BASE}/${encodeURIComponent(profileId)}/watch-history?locale=en-US&page=${page}&page_size=${PAGE_SIZE}&preferred_audio_language=en-US`
    const json = await authedFetch<HistoryPageResponse>(url, jwt)
    if (totalKnown === null && typeof json.total === 'number') totalKnown = json.total

    const data = json.data ?? []
    if (data.length === 0) break

    all.push(...data)
    onProgress({ type: 'page', page, itemsSoFar: all.length, totalKnown })

    if (data.length < PAGE_SIZE) break
    page += 1
    await delay(PAGE_DELAY_MS)
  }

  return all
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

/**
 * Pull the full season+episode catalog for every `seriesId` passed in.
 *
 * Throttled identically to history pagination and resilient to individual
 * series failures — a 404 on one show will not abort the whole run. Each
 * successful series is reported via `onProgress`.
 */
export async function fetchCatalogsForSeries(
  seriesIds: string[],
  jwt: string,
  onProgress: (ev: { index: number; total: number; seriesId: string; ok: boolean; reason?: string }) => void,
): Promise<Map<string, SeriesCatalog>> {
  const out = new Map<string, SeriesCatalog>()
  let idx = 0
  for (const seriesId of seriesIds) {
    idx++
    try {
      const seasons = await fetchSeriesSeasons(seriesId, jwt)
      const catalog: SeriesCatalog = { seriesId, seasons: [] }

      for (const s of seasons) {
        await delay(PAGE_DELAY_MS)
        try {
          const eps = await fetchSeasonEpisodes(s.id, jwt)
          const number = s.season_number ?? s.season_sequence_number ?? catalog.seasons.length + 1
          catalog.seasons.push({
            id: s.id,
            number,
            ...(s.title && { title: s.title }),
            episodes: eps,
          })
        } catch (err) {
          // Skip the offending season and continue with the rest.
          onProgress({
            index: idx,
            total: seriesIds.length,
            seriesId,
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          })
        }
      }

      out.set(seriesId, catalog)
      onProgress({ index: idx, total: seriesIds.length, seriesId, ok: true })
    } catch (err) {
      onProgress({
        index: idx,
        total: seriesIds.length,
        seriesId,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
    await delay(PAGE_DELAY_MS)
  }
  return out
}

function firstPoster(panel: CrunchyrollPanel | undefined): string | undefined {
  const stacks = panel?.images?.poster_tall ?? panel?.images?.poster_wide ?? []
  const stack = stacks[0]
  if (!stack || stack.length === 0) return undefined
  const sorted = [...stack].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return sorted[0]?.source
}

/**
 * Build the ingest payload from watch history plus the full per-series
 * catalog.
 *
 * `items[]` contains every watched event (for the user's progress).
 * `shows[]` is driven off the catalog so every known season/episode — watched
 * or not — is sent to the API. The API dedupes on natural keys so this is
 * idempotent.
 *
 * If a catalog fetch failed for a given series (missing from `catalogs`), we
 * fall back to the partial tree derived from history entries so at minimum
 * the watched episodes still land.
 */
export function buildIngestPayload(
  raw: CrunchyrollHistoryItem[],
  catalogs: Map<string, SeriesCatalog>,
): IngestBody {
  const items: IngestItem[] = []
  const showsByExt = new Map<string, IngestShow>()

  // First, emit shows for which we have full catalog data.
  for (const [seriesId, cat] of catalogs) {
    const sampleHistory = raw.find((r) => r.panel?.episode_metadata?.series_id === seriesId)
    const sampleMeta = sampleHistory?.panel?.episode_metadata
    const title = sampleMeta?.series_title ?? sampleMeta?.season_slug_title ?? seriesId
    const cover = firstPoster(sampleHistory?.panel)

    const seasons: IngestSeason[] = cat.seasons.map((s) => ({
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

    showsByExt.set(seriesId, {
      externalId: seriesId,
      title,
      kind: 'anime',
      seasons,
      ...(cover && { coverUrl: cover }),
    })
  }

  // Walk history to emit watched items AND to fill in trees for series whose
  // catalog fetch failed.
  for (const r of raw) {
    const meta = r.panel?.episode_metadata
    const seriesId = meta?.series_id
    const panelId = r.panel?.id ?? r.id

    items.push({
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
    })

    if (!seriesId) continue
    if (showsByExt.has(seriesId)) continue // already covered by catalog

    // Catalog fetch failed — stitch together a minimal tree from history.
    const title = meta?.series_title ?? meta?.season_slug_title ?? panelId
    const show: IngestShow = showsByExt.get(seriesId) ?? {
      externalId: seriesId,
      title,
      kind: 'anime',
      seasons: [],
      ...(firstPoster(r.panel) && { coverUrl: firstPoster(r.panel)! }),
    }
    showsByExt.set(seriesId, show)

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

  return { items, shows: Array.from(showsByExt.values()) }
}

export function uniqueSeriesIdsFromHistory(raw: CrunchyrollHistoryItem[]): string[] {
  const set = new Set<string>()
  for (const r of raw) {
    const id = r.panel?.episode_metadata?.series_id
    if (id) set.add(id)
  }
  return Array.from(set)
}
