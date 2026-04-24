export interface HistoryItem {
  /** Provider's own media ID for this playback item (episode-level) */
  externalItemId: string
  externalShowId?: string
  externalSeasonId?: string
  watchedAt: Date
  playheadSeconds?: number
  durationSeconds?: number
  fullyWatched?: boolean
  raw: unknown
}

export interface ProviderCursor {
  [key: string]: unknown
}

export interface EpisodeTree {
  number: number
  title?: string
  titles?: Record<string, string>
  descriptions?: Record<string, string>
  durationSeconds?: number
  airDate?: string
  externalId: string
}

export interface SeasonTree {
  number: number
  title?: string
  titles?: Record<string, string>
  airDate?: string
  episodes: EpisodeTree[]
}

export interface ShowTree {
  externalId: string
  title: string
  description?: string
  coverUrl?: string
  year?: number
  kind?: 'anime' | 'tv' | 'movie'
  seasons: SeasonTree[]
}

export interface HistoryPage {
  items: HistoryItem[]
  nextCursor: ProviderCursor | null
}

export interface Credentials {
  /** Opaque credential string (e.g. a bearer token) specific to the provider. */
  token: string
}

export interface Provider {
  readonly key: 'netflix' | 'prime'
  testConnection(creds: Credentials): Promise<{ ok: boolean; error?: string }>
  /** Async generator yielding pages of history since cursor (null = full history) */
  fetchHistorySince(
    creds: Credentials,
    cursor: ProviderCursor | null,
  ): AsyncGenerator<HistoryPage>
  fetchShowMetadata(externalShowId: string, token: string): Promise<ShowTree>
  /** Obtain an auth token (bearer) for use in subsequent calls */
  authenticate(creds: Credentials): Promise<string>
}
