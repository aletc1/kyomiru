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

export const STORAGE_KEYS = {
  config: 'config',
  jwt: 'capturedJwt',
  lastSync: 'lastSync',
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

export async function getLastSync(): Promise<LastSyncInfo | null> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.lastSync)
  return (r[STORAGE_KEYS.lastSync] as LastSyncInfo | undefined) ?? null
}

export async function setLastSync(info: LastSyncInfo): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastSync]: info })
}
