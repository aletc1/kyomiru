/// <reference types="chrome" />

import type { IngestItem, IngestShow } from '@kyomiru/shared/contracts/ingest'

export type SessionStatus =
  | { kind: 'ok'; capturedAt: number; label?: string }
  | { kind: 'expired'; reason: string }
  | { kind: 'missing'; reason: string }

export interface CheckpointItem {
  id: string
  showId?: string
  seasonNumber?: number
  episodeNumber?: number
  raw: unknown
}

export interface ShowCatalog<R = unknown> {
  showId: string
  raw: R
}

export interface HistoryProgress {
  page: number
  itemsSoFar: number
  totalKnown: number | null
}

export interface CatalogProgress {
  index: number
  total: number
  showId: string
  ok: boolean
  reason?: string
}

export interface ProviderAdapter {
  readonly key: string
  readonly displayName: string
  /** URL pattern string for chrome.webRequest urls filter */
  readonly hostMatch: string
  readonly openSessionUrl: string

  hostMatches(url: URL): boolean

  /** Called per outbound request matching hostMatch. Adapters that don't need
   *  to capture request-level auth (e.g. Netflix, which uses cookies) can omit this. */
  onRequest?(details: chrome.webRequest.WebRequestHeadersDetails): Promise<void>

  getSessionStatus(): Promise<SessionStatus>

  paginateHistory(
    onProgress: (ev: HistoryProgress) => void,
  ): AsyncGenerator<unknown>

  uniqueShowIds(history: unknown[]): string[]
  groupHistoryByShow(history: unknown[]): Record<string, unknown[]>
  collectOrphans(history: unknown[]): unknown[]
  toCheckpointItem(row: unknown): CheckpointItem
  buildItemsFromHistory(rows: unknown[]): IngestItem[]
  buildShowFromHistoryFallback(showId: string, rows: unknown[]): IngestShow | null

  streamCatalogsForShows(
    showIds: string[],
    onProgress: (ev: CatalogProgress) => void,
  ): AsyncGenerator<ShowCatalog>

  buildShowFromCatalog(cat: ShowCatalog, sample?: unknown): IngestShow
}
