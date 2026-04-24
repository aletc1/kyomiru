import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SUPPORTED_UI_LOCALES } from '@kyomiru/shared'
import enUS from './locales/en-US/landing.json'
import esES from './locales/es-ES/landing.json'
import frFR from './locales/fr-FR/landing.json'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'en-US': { landing: enUS },
      'es-ES': { landing: esES },
      'fr-FR': { landing: frFR },
    },
    lng: 'en-US',
    fallbackLng: 'en-US',
    ns: ['landing'],
    defaultNS: 'landing',
    interpolation: { escapeValue: false },
  })

const STORAGE_KEY = 'kyomiru-landing-lng'

function normalizeNavigatorLang(raw: string | undefined | null): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('es')) return 'es-ES'
  if (lower.startsWith('fr')) return 'fr-FR'
  if (lower.startsWith('en')) return 'en-US'
  return null
}

function readStoredLocale(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v && (SUPPORTED_UI_LOCALES as readonly string[]).includes(v) ? v : null
  } catch {
    return null
  }
}

export function detectLocaleFromPath(): string | null {
  const segment = window.location.pathname.split('/')[1]
  if (segment === 'es') return 'es-ES'
  if (segment === 'fr') return 'fr-FR'
  return null
}

function isRootPath(): boolean {
  const p = window.location.pathname
  return p === '/' || p === ''
}

export function detectInitialLocale(): { locale: string; redirectTo: string | null } {
  const fromPath = detectLocaleFromPath()
  if (fromPath) return { locale: fromPath, redirectTo: null }

  // Only auto-redirect from the root. Unknown paths (e.g. /pricing) are left alone —
  // they fall through to English without rewriting the URL.
  if (!isRootPath()) {
    return { locale: 'en-US', redirectTo: null }
  }

  const stored = readStoredLocale()
  if (stored) {
    return { locale: stored, redirectTo: stored === 'en-US' ? null : localeToPath(stored) }
  }

  const fromNav = normalizeNavigatorLang(navigator.language)
    ?? normalizeNavigatorLang(navigator.languages?.[0])
  if (fromNav && fromNav !== 'en-US') {
    return { locale: fromNav, redirectTo: localeToPath(fromNav) }
  }

  return { locale: 'en-US', redirectTo: null }
}

export function persistLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // localStorage unavailable (private mode, etc.) — non-fatal
  }
}

export function localeToPath(locale: string): string {
  if (locale === 'es-ES') return '/es'
  if (locale === 'fr-FR') return '/fr'
  return '/'
}

export default i18n
