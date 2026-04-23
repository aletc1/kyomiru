export interface ExtensionConfig {
  kyomiruUrl: string
  token: string
  userEmail?: string
}

export interface CapturedJwt {
  jwt: string
  profileId: string
  capturedAt: number
}

export interface LastSyncInfo {
  at: number
  itemsIngested: number
  itemsNew: number
  ok: boolean
  error?: string
}

export type SyncStatus = 'idle' | 'running' | 'done' | 'error'

export interface SyncState {
  status: SyncStatus
  startedAt?: number
  finishedAt?: number
  /** Stamped on every setSyncState call; detects a worker that died mid-run. */
  heartbeatAt?: number
  log: string[]
  totalIngested?: number
  totalNew?: number
  error?: string
}

export const SYNC_HEARTBEAT_STALE_MS = 2 * 60 * 1000

// Slimmed-down history row persisted in the checkpoint — drops large fields
// like image stacks that we don't need on resume. Must contain enough to
// feed `buildItemsFromHistory` and the history-fallback show builder.
export interface CheckpointHistoryItem {
  id: string
  date_played: string
  playhead: number
  fully_watched: boolean
  panel?: {
    id: string
    episode_metadata?: {
      series_id?: string
      series_title?: string
      season_id?: string
      season_number?: number
      season_title?: string
      episode_number?: number
      title?: string
      duration_ms?: number
      episode_air_date?: string
      season_slug_title?: string
    }
    images?: {
      poster_tall?: Array<Array<{ source: string; width?: number; height?: number }>>
      poster_wide?: Array<Array<{ source: string; width?: number; height?: number }>>
    }
  }
}

export interface SyncCheckpoint {
  providerKey: string
  runId: string
  startedAt: number
  historyBySeries: Record<string, CheckpointHistoryItem[]>
  orphans: CheckpointHistoryItem[]
  /** Slow bucket: unknown or stale series that need catalog fetch + items. */
  seriesIds: string[]
  seriesDoneIdx: number
  /** Fast bucket: known+fresh series where an items-only chunk is sufficient. */
  freshSeriesIds: string[]
  /** True once the Phase-A (items-only) chunk has been posted. */
  freshPhaseDone: boolean
}

export const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const STORAGE_KEYS = {
  config: 'config',
  jwt: 'capturedJwt',
  lastSync: 'lastSync',
  syncState: 'syncState',
  checkpoint: (providerKey: string) => `syncCheckpoint:${providerKey}`,
} as const

export async function getConfig(): Promise<ExtensionConfig | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.config)
  return (r[STORAGE_KEYS.config] as ExtensionConfig | undefined) ?? null
}

export async function setConfig(cfg: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.config]: cfg })
}

export async function clearConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.config)
}

export async function getCapturedJwt(): Promise<CapturedJwt | null> {
  const r = await chrome.storage.session.get(STORAGE_KEYS.jwt)
  return (r[STORAGE_KEYS.jwt] as CapturedJwt | undefined) ?? null
}

export async function setCapturedJwt(info: CapturedJwt): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.jwt]: info })
}

export async function clearCapturedJwt(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEYS.jwt)
}

export async function getLastSync(): Promise<LastSyncInfo | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.lastSync)
  return (r[STORAGE_KEYS.lastSync] as LastSyncInfo | undefined) ?? null
}

export async function setLastSync(info: LastSyncInfo): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastSync]: info })
}

const IDLE_SYNC_STATE: SyncState = { status: 'idle', log: [] }

export async function getSyncState(): Promise<SyncState> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.syncState)
  const state = (r[STORAGE_KEYS.syncState] as SyncState | undefined) ?? IDLE_SYNC_STATE
  if (
    state.status === 'running' &&
    state.heartbeatAt !== undefined &&
    Date.now() - state.heartbeatAt > SYNC_HEARTBEAT_STALE_MS
  ) {
    const sanitized: SyncState = {
      ...state,
      status: 'error',
      finishedAt: Date.now(),
      error: 'Sync interrupted. Click Sync to try again.',
    }
    await setSyncState(sanitized)
    return sanitized
  }
  return state
}

export async function setSyncState(next: SyncState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.syncState]: { ...next, heartbeatAt: Date.now() } })
}

export async function getCheckpoint(providerKey: string): Promise<SyncCheckpoint | null> {
  const key = STORAGE_KEYS.checkpoint(providerKey)
  const r = await chrome.storage.local.get(key)
  return (r[key] as SyncCheckpoint | undefined) ?? null
}

export async function setCheckpoint(cp: SyncCheckpoint): Promise<void> {
  const key = STORAGE_KEYS.checkpoint(cp.providerKey)
  await chrome.storage.local.set({ [key]: cp })
}

export async function clearCheckpoint(providerKey: string): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.checkpoint(providerKey))
}

export function isCheckpointStale(cp: SyncCheckpoint, now = Date.now()): boolean {
  return now - cp.startedAt > CHECKPOINT_MAX_AGE_MS
}

/**
 * Decode the `exp` claim (Unix seconds) from a JWT without verifying the signature.
 * Returns null on any parse failure.
 */
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

export function isCapturedJwtExpired(info: CapturedJwt, skewSeconds = 30): boolean {
  const exp = decodeJwtExp(info.jwt)
  if (exp === null) return true
  return exp * 1000 <= Date.now() + skewSeconds * 1000
}
