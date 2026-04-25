// Maps app UI locale to JustWatch country code + localized search path segment.
// JustWatch translates the search path per country (es→buscar, fr→recherche,
// de→Suche, …); using the wrong path 404s. Only verified entries belong here.
// Fallback: en-US / /us/search.
const LOCALE_SEARCH: Record<string, { cc: string; path: string }> = {
  'en-US': { cc: 'us', path: 'search' },
  'es-ES': { cc: 'es', path: 'buscar' },
  'fr-FR': { cc: 'fr', path: 'recherche' },
  'de-DE': { cc: 'de', path: 'Suche' },
}

const FALLBACK = LOCALE_SEARCH['en-US']!

export function justWatchSearchUrl(opts: {
  title: string
  year?: number | null
  uiLocale: string
}): string {
  const { cc, path } = LOCALE_SEARCH[opts.uiLocale] ?? FALLBACK
  const q = opts.year != null ? `${opts.title} ${opts.year}` : opts.title
  return `https://www.justwatch.com/${cc}/${path}?q=${encodeURIComponent(q)}`
}
