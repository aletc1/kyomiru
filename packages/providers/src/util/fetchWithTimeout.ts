export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}
