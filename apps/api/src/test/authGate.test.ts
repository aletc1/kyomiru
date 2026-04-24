import { describe, it, expect, vi, beforeEach } from 'vitest'
import { globToRegex, isEmailApproved, invalidateApprovalCache } from '../services/authGate.js'

describe('globToRegex', () => {
  it('matches emails at a domain', () => {
    const re = globToRegex('*@company.com')
    expect(re.test('alice@company.com')).toBe(true)
    expect(re.test('bob@company.com')).toBe(true)
  })

  it('is anchored — rejects partial matches', () => {
    const re = globToRegex('*@company.com')
    expect(re.test('alice@company.com.evil.io')).toBe(false)
    expect(re.test('prefix.alice@company.com')).toBe(true) // * covers everything before @
  })

  it('escapes regex metacharacters in the domain', () => {
    const re = globToRegex('*@acme.io')
    // dot is escaped — "acmeXio" must NOT match
    expect(re.test('x@acmeXio')).toBe(false)
  })

  it('is case-insensitive', () => {
    const re = globToRegex('*@Company.Com')
    expect(re.test('alice@company.com')).toBe(true)
    expect(re.test('ALICE@COMPANY.COM')).toBe(true)
  })

  it('supports subdomain wildcards', () => {
    const re = globToRegex('*@*.company.com')
    expect(re.test('user@mail.company.com')).toBe(true)
    expect(re.test('user@company.com')).toBe(false)
  })
})

// ── isEmailApproved — behaviour tests with mocked dependencies ───────────────

const mockRedisGet = vi.fn<() => Promise<string | null>>()
const mockRedisSetex = vi.fn()
const mockRedisDel = vi.fn()
const mockDbSelect = vi.fn()

function makeApp(
  opts: { disableAutoSignup?: boolean; pattern?: string } = {},
): Parameters<typeof import('../services/authGate.js')['isEmailApproved']>[0] {
  return {
    config: {
      DISABLE_AUTO_SIGNUP: opts.disableAutoSignup ?? true,
      AUTO_SIGNUP_EMAIL_PATTERN: opts.pattern,
    },
    redis: {
      get: mockRedisGet,
      setex: mockRedisSetex,
      del: mockRedisDel,
    },
    db: {
      select: mockDbSelect,
    },
  } as unknown as Parameters<typeof import('../services/authGate.js')['isEmailApproved']>[0]
}

describe('isEmailApproved', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true immediately when DISABLE_AUTO_SIGNUP is false (no Redis/DB calls)', async () => {
    const app = makeApp({ disableAutoSignup: false })
    const result = await isEmailApproved(app, 'anyone@anywhere.com')
    expect(result).toBe(true)
    expect(mockRedisGet).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns true from Redis cache hit "1"', async () => {
    mockRedisGet.mockResolvedValueOnce('1')
    const app = makeApp()
    expect(await isEmailApproved(app, 'alice@x.com')).toBe(true)
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns false from Redis cache hit "0"', async () => {
    mockRedisGet.mockResolvedValueOnce('0')
    const app = makeApp()
    expect(await isEmailApproved(app, 'alice@x.com')).toBe(false)
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('returns true and caches "1" on DB allowlist hit', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    // Simulate Drizzle chained query returning a row
    mockDbSelect.mockReturnValueOnce({
      select: mockDbSelect,
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ email: 'alice@x.com' }]),
        }),
      }),
    })
    const app = makeApp()
    expect(await isEmailApproved(app, 'alice@x.com')).toBe(true)
    expect(mockRedisSetex).toHaveBeenCalledWith('auth:approved:alice@x.com', 300, '1')
  })

  it('returns true and caches "1" on glob pattern match', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockDbSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    })
    const app = makeApp({ pattern: '*@acme.com' })
    expect(await isEmailApproved(app, 'carol@acme.com')).toBe(true)
    expect(mockRedisSetex).toHaveBeenCalledWith('auth:approved:carol@acme.com', 300, '1')
  })

  it('returns false and caches "0" when no match', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockDbSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    })
    const app = makeApp({ pattern: '*@acme.com' })
    expect(await isEmailApproved(app, 'eve@evil.io')).toBe(false)
    expect(mockRedisSetex).toHaveBeenCalledWith('auth:approved:eve@evil.io', 300, '0')
  })

  it('glob does not match attacker suffix', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockDbSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    })
    const app = makeApp({ pattern: '*@acme.com' })
    expect(await isEmailApproved(app, 'eve@acme.com.evil.io')).toBe(false)
  })

  it('is case-insensitive for the cache key', async () => {
    mockRedisGet.mockResolvedValueOnce('1')
    const app = makeApp()
    await isEmailApproved(app, 'ALICE@X.COM')
    expect(mockRedisGet).toHaveBeenCalledWith('auth:approved:alice@x.com')
  })
})

describe('invalidateApprovalCache', () => {
  it('deletes the lowercase-normalised key', async () => {
    const app = makeApp()
    await invalidateApprovalCache(app, 'ALICE@X.COM')
    expect(mockRedisDel).toHaveBeenCalledWith('auth:approved:alice@x.com')
  })
})
