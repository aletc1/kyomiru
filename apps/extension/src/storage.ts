import type { CheckpointItem } from './providers/types.js'

export interface ExtensionConfig {
  kyomiruUrl: string
  token: string
  userEmail?: string
}

// ─── Per-provider session types ───────────────────────────────────────────────

/** Crunchyroll session: captured from webRequest Authorization header. */
export interface CrunchyrollSession {
  jwt: string
  profileId: string
  capturedAt: number
}

/** Netflix session: just the profile guid discovered on last successful sync. */
export interface NetflixSession {
  profileGuid: string
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

export interface SyncCheckpoint {
  providerKey: string
  runId: string
  startedAt: number
  historyByShow: Record<string, CheckpointItem[]>
  orphans: CheckpointItem[]
  /** Slow bucket: unknown or stale shows that need catalog fetch + items. */
  showIds: string[]
  showDoneIdx: number
  /** Fast bucket: known+fresh shows where an items-only chunk is sufficient. */
  freshShowIds: string[]
  /** True once the Phase-A (items-only) chunk has been posted. */
  freshPhaseDone: boolean
}

export const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const STORAGE_KEYS = {
  config: 'config',
  session: (providerKey: string) => `capturedSession:${providerKey}`,
  lastSync: (providerKey: string) => `lastSync:${providerKey}`,
  syncState: (providerKey: string) => `syncState:${providerKey}`,
  checkpoint: (providerKey: string) => `syncCheckpoint:${providerKey}`,
} as const

// ─── Config ───────────────────────────────────────────────────────────────────

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

// ─── Auth error flag (persists across config clear so popup can show banner) ──

export async function getAuthError(): Promise<boolean> {
  const r = await chrome.storage.local.get('authError')
  return (r['authError'] as boolean | undefined) ?? false
}

export async function setAuthError(v: boolean): Promise<void> {
  if (v) {
    await chrome.storage.local.set({ authError: true })
  } else {
    await chrome.storage.local.remove('authError')
  }
}

// ─── Per-provider session ─────────────────────────────────────────────────────

export async function getSession<T>(providerKey: string): Promise<T | null> {
  const key = STORAGE_KEYS.session(providerKey)
  const r = await chrome.storage.session.get(key)
  return (r[key] as T | undefined) ?? null
}

export async function setSession<T>(providerKey: string, data: T): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.session(providerKey)]: data })
}

export async function clearSession(providerKey: string): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEYS.session(providerKey))
}

// ─── Last sync ────────────────────────────────────────────────────────────────

export async function getLastSync(providerKey: string): Promise<LastSyncInfo | null> {
  const key = STORAGE_KEYS.lastSync(providerKey)
  const r = await chrome.storage.local.get(key)
  return (r[key] as LastSyncInfo | undefined) ?? null
}

export async function setLastSync(providerKey: string, info: LastSyncInfo): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastSync(providerKey)]: info })
}

// ─── Sync state ───────────────────────────────────────────────────────────────

const IDLE_SYNC_STATE: SyncState = { status: 'idle', log: [] }

export async function getSyncState(providerKey: string): Promise<SyncState> {
  const key = STORAGE_KEYS.syncState(providerKey)
  const r = await chrome.storage.local.get(key)
  const state = (r[key] as SyncState | undefined) ?? IDLE_SYNC_STATE
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
    await setSyncState(providerKey, sanitized)
    return sanitized
  }
  return state
}

export async function setSyncState(providerKey: string, next: SyncState): Promise<void> {
  const key = STORAGE_KEYS.syncState(providerKey)
  await chrome.storage.local.set({ [key]: { ...next, heartbeatAt: Date.now() } })
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

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
