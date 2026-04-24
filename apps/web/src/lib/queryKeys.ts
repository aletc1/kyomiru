export const Q = {
  me: ['me'] as const,
  library: (params: Record<string, unknown>) => ['library', params] as const,
  libraryFacets: ['library', 'facets'] as const,
  show: (id: string) => ['show', id] as const,
  services: ['services'] as const,
  newContentCount: ['new-content-count'] as const,
  queue: ['queue'] as const,
  extensionTokens: ['extension', 'tokens'] as const,
}
