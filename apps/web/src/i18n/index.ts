import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import commonEn from './locales/en-US/common.json'
import authEn from './locales/en-US/auth.json'
import libraryEn from './locales/en-US/library.json'
import showEn from './locales/en-US/show.json'
import settingsEn from './locales/en-US/settings.json'
import servicesEn from './locales/en-US/services.json'

export const NAMESPACES = ['common', 'auth', 'library', 'show', 'settings', 'services'] as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'en-US': {
        common: commonEn,
        auth: authEn,
        library: libraryEn,
        show: showEn,
        settings: settingsEn,
        services: servicesEn,
      },
    },
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'es-ES', 'fr-FR'],
    ns: NAMESPACES,
    defaultNS: 'common',
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lng',
      lookupLocalStorage: 'kyomiru-lng',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  })

export async function loadLocale(lng: string) {
  const safe = ['en-US', 'es-ES', 'fr-FR'].includes(lng) ? lng : 'en-US'
  if (safe === 'en-US') {
    if (i18n.language !== 'en-US') await i18n.changeLanguage('en-US')
    return
  }
  await Promise.all(
    NAMESPACES.map(async (ns) => {
      if (i18n.hasResourceBundle(safe, ns)) return
      const mod = await import(`./locales/${safe}/${ns}.json`)
      i18n.addResourceBundle(safe, ns, mod.default ?? mod, true, true)
    }),
  )
  if (i18n.language !== safe) await i18n.changeLanguage(safe)
}

export default i18n
