import { describe, it, expect } from 'vitest'
import { LibraryQuerySchema } from '@kyomiru/shared/contracts/library'

describe('LibraryQuerySchema', () => {
  it('coerces limit and applies defaults', () => {
    const r = LibraryQuerySchema.parse({ limit: '60' })
    expect(r.limit).toBe(60)
    expect(r.sort).toBe('recent_activity')
    expect(r.group).toBe('none')
    expect(r.kind).toBeUndefined()
    expect(r.provider).toBeUndefined()
  })

  it('caps limit at 100 and rejects below 1', () => {
    expect(() => LibraryQuerySchema.parse({ limit: '0' })).toThrow()
    expect(() => LibraryQuerySchema.parse({ limit: '101' })).toThrow()
  })

  it('accepts valid kind values', () => {
    expect(LibraryQuerySchema.parse({ kind: 'anime' }).kind).toBe('anime')
    expect(LibraryQuerySchema.parse({ kind: 'tv' }).kind).toBe('tv')
    expect(LibraryQuerySchema.parse({ kind: 'movie' }).kind).toBe('movie')
  })

  it('rejects unknown kind values (no unsafe cast into SQL)', () => {
    expect(() => LibraryQuerySchema.parse({ kind: 'documentary' })).toThrow()
    expect(() => LibraryQuerySchema.parse({ kind: '' })).toThrow()
  })

  it('rejects unknown status values', () => {
    expect(() => LibraryQuerySchema.parse({ status: 'paused' })).toThrow()
  })

  it('accepts free-form provider strings', () => {
    // Provider is validated at the data layer (EXISTS subquery returns nothing
    // for unknown keys); the schema only enforces that it is a string.
    expect(LibraryQuerySchema.parse({ provider: 'crunchyroll' }).provider).toBe('crunchyroll')
    expect(LibraryQuerySchema.parse({ provider: 'unknown-key' }).provider).toBe('unknown-key')
  })
})
