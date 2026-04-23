/// <reference types="chrome" />

import { setCapturedJwt } from './storage.js'

const CR_MATCH = '*://*.crunchyroll.com/content/*'

/**
 * Extract the Crunchyroll profile/account id from a URL like
 *   https://www.crunchyroll.com/content/v2/<profile_id>/watch-history?...
 * Returns null if the URL doesn't match the expected shape.
 */
function extractProfileId(url: string): string | null {
  const match = url.match(/\/content\/v2\/([^/]+)\//)
  return match?.[1] ?? null
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const auth = details.requestHeaders?.find((h) => h.name.toLowerCase() === 'authorization')?.value
    if (!auth?.startsWith('Bearer ')) return
    const jwt = auth.slice('Bearer '.length).trim()
    if (!jwt) return

    const profileId = extractProfileId(details.url)
    if (!profileId) return

    setCapturedJwt({ jwt, profileId, capturedAt: Date.now() }).catch((err) => {
      console.warn('[Kyomiru] Failed to store captured JWT', err)
    })
  },
  { urls: [CR_MATCH] },
  ['requestHeaders', 'extraHeaders'],
)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Kyomiru] Extension installed. Open crunchyroll.com once to capture a session JWT.')
})
