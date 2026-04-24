import enUS from './locales/en-US.json'
import esES from './locales/es-ES.json'
import frFR from './locales/fr-FR.json'

type Strings = typeof enUS
type StringKey = keyof Strings

const BUNDLES: Record<string, Strings> = {
  'en-US': enUS,
  'es-ES': esES,
  'fr-FR': frFR,
}

let _locale = 'en-US'

function normalizeLocale(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.startsWith('es')) return 'es-ES'
  if (lower.startsWith('fr')) return 'fr-FR'
  return 'en-US'
}

export function initLocale(preferred?: string | null): void {
  if (preferred && BUNDLES[preferred]) {
    _locale = preferred
    return
  }
  const uiLang = chrome.i18n.getUILanguage()
  _locale = normalizeLocale(uiLang)
}

export function currentLocale(): string {
  return _locale
}

export function t(key: StringKey, subs?: Record<string, string | number>): string {
  const bundle = BUNDLES[_locale] ?? BUNDLES['en-US']
  let str: string = (bundle as Record<string, string>)[key] ?? (BUNDLES['en-US'] as Record<string, string>)[key] ?? key
  if (subs) {
    for (const [k, v] of Object.entries(subs)) {
      str = str.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return str
}
