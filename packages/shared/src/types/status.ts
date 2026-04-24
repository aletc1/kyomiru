export const SHOW_STATUSES = ['in_progress', 'new_content', 'watched', 'removed'] as const
export type ShowStatus = (typeof SHOW_STATUSES)[number]

export const PROVIDER_KEYS = ['netflix', 'prime', 'crunchyroll'] as const
export type ProviderKey = (typeof PROVIDER_KEYS)[number]

/** Providers whose watch history is synced via the Chrome extension (not a server-side bearer token). */
export const EXTENSION_PROVIDER_KEYS = ['crunchyroll', 'netflix'] as const
export type ExtensionProviderKey = (typeof EXTENSION_PROVIDER_KEYS)[number]

export const SYNC_TRIGGERS = ['manual', 'cron'] as const
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number]

export const SYNC_STATUSES = ['running', 'success', 'partial', 'error'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export const SERVICE_STATUSES = ['connected', 'disconnected', 'error'] as const
export type ServiceStatus = (typeof SERVICE_STATUSES)[number]

export const SORT_OPTIONS = ['recent_activity', 'title_asc', 'rating', 'last_watched', 'latest_air_date'] as const
export type SortOption = (typeof SORT_OPTIONS)[number]

export const GROUP_OPTIONS = ['none', 'provider', 'genre', 'rating', 'last_activity'] as const
export type GroupOption = (typeof GROUP_OPTIONS)[number]

export const SHOW_KINDS = ['anime', 'tv', 'movie'] as const
export type ShowKind = (typeof SHOW_KINDS)[number]
