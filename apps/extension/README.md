# Kyomiru Chrome Extension

Syncs watch history from supported streaming sites into your Kyomiru instance via your live browser session.

## Supported providers

| Provider | Auth mechanism | How history is captured |
|---|---|---|
| **Crunchyroll** | Bearer JWT (captured from outgoing requests) | Background service worker observes `*.crunchyroll.com` requests and stores the short-lived JWT in `chrome.storage.session`. |
| **Netflix** | Browser cookies (sent automatically) | Extension fetches Netflix's Shakti viewing-activity API using your existing login cookies. No passwords or tokens are stored. |

## How it works

1. The background service worker registers a `webRequest` listener for Crunchyroll to capture its Bearer JWT. Netflix uses cookie auth — no capture step needed.
2. When you click **Sync now** (or the daily alarm fires), the extension for each connected provider:
   - Paginates the provider's watch-history API.
   - Asks the Kyomiru server which shows it already has full catalog coverage for (resolve step).
   - Fetches the per-show catalog for unknown/stale shows (Crunchyroll only; Netflix synthesises a catalog from history and relies on TMDb enrichment).
   - Streams chunks of `{ items, shows }` to `/api/providers/<key>/ingest/chunk`.
   - Finalises the sync run so the server recomputes `user_show_state`.
3. The popup auto-detects the active tab and shows the matching provider's card first. On any other page all provider cards are shown.
4. A `chrome.alarms` alarm fires every 24 h and syncs all providers whose session is valid — no manual action required.

The Kyomiru server never calls Crunchyroll or Netflix directly — that was the whole point of moving the provider into the browser.

## Build

```bash
pnpm --filter @kyomiru/extension build
```

Outputs an unpacked MV3 extension at `apps/extension/dist/`.

## Install (development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and pick `apps/extension/dist/`
4. Click the extension icon → paste your extension token (generated at `Kyomiru → Settings → Extension tokens`). The Kyomiru URL is auto-detected; tick **Advanced options** to override it.
5. Click **Connect**. The popup will request host permission for your Kyomiru origin.
6. Navigate to `https://www.crunchyroll.com` or `https://www.netflix.com` and browse any page so the extension establishes a session.
7. Open the extension popup and click **Sync now** on the relevant provider card.

## Data boundary

- **Crunchyroll JWT** — stays in `chrome.storage.session` under `capturedSession:crunchyroll`. Never sent to Kyomiru.
- **Netflix session metadata** (`buildId`, `authURL`, `profileGuid`) — stays in `chrome.storage.session` under `capturedSession:netflix`. Refreshed on every sync. Never sent to Kyomiru.
- **Kyomiru extension token** — stored in `chrome.storage.local`. Used as `Authorization: Bearer` for `/api/extension/me` and `/api/providers/<key>/ingest/*`.
- **Sync checkpoint** — lightweight resume state per provider stored in `chrome.storage.local` under `syncCheckpoint:<providerKey>`. Discarded after finalize or after 24 h.
