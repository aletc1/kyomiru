# Kyomiru Chrome Extension

Syncs Crunchyroll watch history from your live browser session into a Kyomiru instance.

## How it works

1. Background service worker observes Crunchyroll's own API requests (`*.crunchyroll.com/content/*`) and captures the short-lived `Authorization: Bearer` JWT into `chrome.storage.session`. Cookies are never touched — Crunchyroll uses a Bearer token for all content API calls.
2. Popup calls `https://www.crunchyroll.com/content/v2/<profile_id>/watch-history` page by page using the captured JWT, builds a normalized payload, and POSTs it to the configured Kyomiru API.
3. The Kyomiru API authenticates the request with an extension token (generated in Kyomiru → Settings → Extension tokens) and runs the regular ingest pipeline (`watch_events` → `user_episode_progress` → `user_show_state`).

The Kyomiru server never calls Crunchyroll — that was the whole point of moving the provider into the browser.

## Build

```bash
pnpm --filter @kyomiru/extension build
```

Outputs an unpacked MV3 extension at `apps/extension/dist/`.

## Install (development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and pick `apps/extension/dist/`
4. Click the extension icon → paste your Kyomiru URL (e.g. `http://localhost:3000`) + an extension token from `Kyomiru → Settings → Extension tokens`
5. Click **Connect**. The popup will request host permission for your Kyomiru origin.
6. Navigate to `https://www.crunchyroll.com` and open any page (the background worker captures the JWT)
7. Open the extension popup and click **Sync now**

## Data boundary

- Crunchyroll JWT: stays in `chrome.storage.session` inside the extension. Never sent to Kyomiru.
- Kyomiru extension token: stored in `chrome.storage.local`. Used as `Authorization: Bearer` for `/api/extension/me` and `/api/providers/crunchyroll/ingest`.
