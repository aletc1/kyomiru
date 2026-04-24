import { describe, it, expect } from 'vitest'
import { pickLocalized, resolveRequestLocales } from './locale.js'

describe('pickLocalized', () => {
  it('returns exact locale match', () => {
    expect(pickLocalized({ 'ja-JP': 'テスト', en: 'Test' }, ['ja-JP'])).toBe('テスト')
  })

  it('falls back to base language code', () => {
    expect(pickLocalized({ ja: '日本語', en: 'English' }, ['ja-JP'])).toBe('日本語')
  })

  it('falls back to en when no locale matches', () => {
    expect(pickLocalized({ en: 'English', ja: '日本語' }, ['fr-FR'])).toBe('English')
  })

  it('falls back to scalar fallback when map is empty', () => {
    expect(pickLocalized({}, ['ja-JP'], 'Fallback')).toBe('Fallback')
  })

  it('returns null when map is null and no fallback', () => {
    expect(pickLocalized(null, ['en'])).toBeNull()
  })

  it('tries locales in order', () => {
    const map = { es: 'Español', fr: 'Français' }
    expect(pickLocalized(map, ['fr-FR', 'es-ES'])).toBe('Français')
  })
})

describe('resolveRequestLocales', () => {
  it('places preferredLocale first', () => {
    const locales = resolveRequestLocales('en-US', 'ja-JP')
    expect(locales[0]).toBe('ja-JP')
  })

  it('parses Accept-Language with quality values', () => {
    const locales = resolveRequestLocales('fr-FR;q=0.9,en-US;q=1.0', undefined)
    expect(locales[0]).toBe('en-US')
    expect(locales[1]).toBe('fr-FR')
  })

  it('always includes en-US and en as fallback', () => {
    const locales = resolveRequestLocales(undefined, undefined)
    expect(locales).toContain('en-US')
    expect(locales).toContain('en')
  })

  it('deduplicates locales', () => {
    const locales = resolveRequestLocales('en-US', 'en-US')
    expect(locales.filter((l) => l === 'en-US').length).toBe(1)
  })
})
