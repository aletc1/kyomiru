import { crunchyrollAdapter } from './crunchyroll.js'
import { netflixAdapter } from './netflix.js'
import type { ProviderAdapter } from './types.js'

export const adapters: Record<string, ProviderAdapter> = {
  crunchyroll: crunchyrollAdapter,
  netflix: netflixAdapter,
}

export function adapterForTab(url: string | undefined): ProviderAdapter | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return Object.values(adapters).find((a) => a.hostMatches(parsed)) ?? null
}

export function allAdapters(): ProviderAdapter[] {
  return Object.values(adapters)
}

export type { ProviderAdapter } from './types.js'
export type { CheckpointItem, SessionStatus, HistoryProgress, CatalogProgress, ShowCatalog } from './types.js'
