import { describe, it, expect } from 'vitest'
import { justWatchSearchUrl } from './justwatch'

describe('justWatchSearchUrl', () => {
  it('uses /us/search for en-US', () => {
    expect(justWatchSearchUrl({ title: 'Breaking Bad', year: 2008, uiLocale: 'en-US' }))
      .toBe('https://www.justwatch.com/us/search?q=Breaking%20Bad%202008')
  })

  it('uses /es/buscar for es-ES', () => {
    expect(justWatchSearchUrl({ title: 'ONE PIECE', year: 1999, uiLocale: 'es-ES' }))
      .toBe('https://www.justwatch.com/es/buscar?q=ONE%20PIECE%201999')
  })

  it('uses /fr/recherche for fr-FR', () => {
    expect(justWatchSearchUrl({ title: 'Frieren', year: 2023, uiLocale: 'fr-FR' }))
      .toBe('https://www.justwatch.com/fr/recherche?q=Frieren%202023')
  })

  it('falls back to /us/search for unknown locales', () => {
    expect(justWatchSearchUrl({ title: 'Frieren', uiLocale: 'zh-CN' }))
      .toBe('https://www.justwatch.com/us/search?q=Frieren')
  })

  it('omits year when null', () => {
    expect(justWatchSearchUrl({ title: 'Breaking Bad', year: null, uiLocale: 'en-US' }))
      .toBe('https://www.justwatch.com/us/search?q=Breaking%20Bad')
  })

  it('url-encodes special characters', () => {
    expect(justWatchSearchUrl({ title: "Frieren: Beyond Journey's End", year: 2023, uiLocale: 'en-US' }))
      .toBe("https://www.justwatch.com/us/search?q=Frieren%3A%20Beyond%20Journey's%20End%202023")
  })
})
