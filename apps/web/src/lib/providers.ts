export interface ProviderMeta {
  tagline: string
  connectionKind: 'extension' | 'bearer'
  siteUrl: string
  siteLabel: string
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  crunchyroll: {
    tagline: 'Anime simulcasts. Synced from your browser via the Kyomiru Chrome extension.',
    connectionKind: 'extension',
    siteUrl: 'https://www.crunchyroll.com',
    siteLabel: 'crunchyroll.com',
  },
  netflix: {
    tagline: 'Movies and TV. Synced from your browser via the Kyomiru Chrome extension.',
    connectionKind: 'extension',
    siteUrl: 'https://www.netflix.com',
    siteLabel: 'netflix.com',
  },
  prime: {
    tagline: 'Prime Video catalogue. Requires a bearer token from the Prime Video web app.',
    connectionKind: 'bearer',
    siteUrl: 'https://www.amazon.com/prime-video',
    siteLabel: 'amazon.com/prime-video',
  },
}
