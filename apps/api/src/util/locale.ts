/**
 * Select the best available localized string from a locale map.
 *
 * Tries each locale in order, then the base language code (ja-JP → ja),
 * then 'en' / 'en-US' as a universal tail fallback for callers that didn't
 * already append them, then the scalar `fallback` (the legacy
 * canonical_title / description column).
 */
export function pickLocalized(
  map: Record<string, string> | null | undefined,
  locales: string[],
  fallback?: string | null,
): string | null {
  if (!map || Object.keys(map).length === 0) return fallback ?? null
  for (const locale of locales) {
    if (map[locale]) return map[locale]!
    const base = locale.split('-')[0]
    if (base && base !== locale && map[base]) return map[base]!
  }
  if (map['en']) return map['en']!
  if (map['en-US']) return map['en-US']!
  return fallback ?? null
}

/**
 * Build an ordered, de-duped locale preference list for a request.
 *
 * Priority: user's saved preferredLocale → Accept-Language header → 'en-US'/'en'.
 */
export function resolveRequestLocales(
  acceptLanguage: string | undefined,
  preferredLocale: string | null | undefined,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  const add = (locale: string) => {
    const trimmed = locale.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }

  if (preferredLocale) add(preferredLocale)

  if (acceptLanguage) {
    const parsed = acceptLanguage
      .split(',')
      .map((part) => {
        const [lang, qPart] = part.trim().split(';q=')
        return { lang: (lang ?? '').trim(), q: qPart ? parseFloat(qPart) : 1 }
      })
      .filter((l) => l.lang && l.lang !== '*')
      .sort((a, b) => b.q - a.q)
    for (const { lang } of parsed) add(lang)
  }

  add('en-US')
  add('en')

  return result
}
