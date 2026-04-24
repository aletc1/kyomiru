import { describe, it, expect, beforeAll } from 'vitest'
import i18n from '@/i18n'
import { translateApiError } from './api'

describe('translateApiError', () => {
  beforeAll(async () => {
    if (i18n.language !== 'en-US') await i18n.changeLanguage('en-US')
  })

  it('passes through unknown messages unchanged', () => {
    expect(translateApiError('Some bespoke server error')).toBe('Some bespoke server error')
  })

  it('translates a known mapped error in en-US', () => {
    expect(translateApiError('Unauthorized')).toBe('Unauthorized')
  })

  it('translates "User not found" in en-US', () => {
    expect(translateApiError('User not found')).toBe('User not found')
  })

  it('translates "Extension token was revoked..." in en-US', () => {
    expect(translateApiError('Extension token was revoked. Pair the device again.'))
      .toBe('Extension token was revoked. Pair the device again.')
  })

  it('returns the localized form when language is es-ES', async () => {
    // Manually load es-ES common bundle (test runs without DOM/network fetch)
    const es = await import('@/i18n/locales/es-ES/common.json')
    i18n.addResourceBundle('es-ES', 'common', es.default ?? es, true, true)
    await i18n.changeLanguage('es-ES')
    try {
      expect(translateApiError('Unauthorized')).toBe('No autorizado')
      expect(translateApiError('User not found')).toBe('Usuario no encontrado')
    } finally {
      await i18n.changeLanguage('en-US')
    }
  })
})
