import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'
import i18n, { detectInitialLocale, detectLocaleFromPath } from './i18n'
import { updateHead } from './i18n/head'

const { locale, redirectTo } = detectInitialLocale()
if (redirectTo) {
  window.history.replaceState({}, '', redirectTo)
}
i18n.changeLanguage(locale).then(() => updateHead(locale))

window.addEventListener('popstate', () => {
  const next = detectLocaleFromPath() ?? 'en-US'
  if (next === i18n.language) return
  i18n.changeLanguage(next).then(() => updateHead(next))
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
