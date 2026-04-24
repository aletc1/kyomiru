import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { approvedEmails } from '@kyomiru/db/schema'

// Anchored and case-insensitive so "*@company.com" can't match "x@company.com.evil.io".
// Exported for unit tests.
export function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i')
}

const patternCache = new Map<string, RegExp>()

function getCompiledPattern(app: FastifyInstance): RegExp | null {
  const raw = app.config.AUTO_SIGNUP_EMAIL_PATTERN
  if (!raw) return null
  let regex = patternCache.get(raw)
  if (!regex) {
    regex = globToRegex(raw)
    patternCache.set(raw, regex)
  }
  return regex
}

export async function isEmailApproved(app: FastifyInstance, email: string): Promise<boolean> {
  if (!app.config.DISABLE_AUTO_SIGNUP) return true

  const lowerEmail = email.toLowerCase()
  const key = `auth:approved:${lowerEmail}`

  const cached = await app.redis.get(key)
  if (cached === '1') return true
  if (cached === '0') return false

  const [row] = await app.db
    .select({ email: approvedEmails.email })
    .from(approvedEmails)
    .where(eq(approvedEmails.email, lowerEmail))
    .limit(1)

  if (row) {
    await app.redis.setex(key, 300, '1')
    return true
  }

  const pattern = getCompiledPattern(app)
  if (pattern && pattern.test(lowerEmail)) {
    await app.redis.setex(key, 300, '1')
    return true
  }

  await app.redis.setex(key, 300, '0')
  return false
}

export async function invalidateApprovalCache(app: FastifyInstance, email: string): Promise<void> {
  await app.redis.del(`auth:approved:${email.toLowerCase()}`)
}
