import i18n from '@/i18n'

const KNOWN_ERROR_KEYS: Record<string, string> = {
  'Extension token was revoked. Pair the device again.': 'error_token_revoked',
  'Unauthorized': 'error_unauthorized',
  'User not found': 'error_user_not_found',
  'Internal server error': 'error_internal',
  'Forbidden': 'error_forbidden',
}

export function translateApiError(message: string): string {
  const key = KNOWN_ERROR_KEYS[message]
  if (!key) return message
  const translated = i18n.t(`common:${key}`, { defaultValue: '' })
  return translated || message
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init.body !== null
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(hasBody && { 'Content-Type': 'application/json' }), ...init?.headers },
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(translateApiError(err.error ?? `HTTP ${res.status}`))
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body !== undefined && { body: JSON.stringify(body) }) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', ...(body !== undefined && { body: JSON.stringify(body) }) }),
}
