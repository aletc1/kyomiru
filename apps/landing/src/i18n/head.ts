import i18n from './index'

export function updateHead(locale: string) {
  const t = (key: string) => i18n.t(key, { lng: locale })

  document.title = t('meta_title')

  const setMeta = (selector: string, attr: string, value: string) => {
    const el = document.querySelector(selector)
    if (el) el.setAttribute(attr, value)
  }

  setMeta('meta[name="description"]', 'content', t('meta_description'))
  setMeta('meta[property="og:title"]', 'content', t('meta_title'))
  setMeta('meta[property="og:description"]', 'content', t('meta_description'))
  setMeta('meta[name="twitter:title"]', 'content', t('meta_title'))
  setMeta('meta[name="twitter:description"]', 'content', t('meta_description'))

  document.documentElement.lang = locale === 'es-ES' ? 'es' : locale === 'fr-FR' ? 'fr' : 'en'
}
