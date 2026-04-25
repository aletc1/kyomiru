# Development

## Prerequisites

- **Node 20** — use `nvm use` (`.nvmrc` is included)
- **pnpm 10** — `npm install -g pnpm`
- **Docker** — for the local Postgres + Redis containers

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and configure the environment file
cp .env.example apps/api/.env
# Edit apps/api/.env — at minimum fill in APP_SECRET_KEY, SESSION_SECRET, and Google OAuth credentials

# 3. Start infrastructure
pnpm db:up

# 4. Apply migrations and seed provider registry
pnpm db:migrate
pnpm db:seed

# 5. Start development servers (api :3000, web :5173)
pnpm dev
```

The Vite dev server proxies `/api/*` to `localhost:3000` automatically. Open [http://localhost:5173](http://localhost:5173).

## Repository layout

```
kyomiru/
├── apps/
│   ├── api/        Fastify 5 REST API + BullMQ enrichment / show-refresh / show-merge workers
│   ├── web/        React 18 PWA (Vite 6, TanStack Router + Query)
│   └── extension/  Chrome MV3 extension (Crunchyroll + Netflix ingest)
├── packages/
│   ├── shared/     Zod contracts shared by api and web
│   ├── db/         Drizzle ORM schema, migrations, seed
│   ├── providers/  Enrichment abstraction (AniList + TMDb)
│   └── config/     Shared tsconfig presets
├── infra/
│   ├── compose/    docker-compose.dev.yml (Postgres + Redis)
│   └── docker/     Production Dockerfiles + nginx config
└── .env.example
```

## Commands

### Development

```bash
pnpm dev                              # start api + web in watch mode
pnpm --filter @kyomiru/api dev        # api only
pnpm --filter @kyomiru/web dev        # web only
```

### Building

```bash
pnpm build                            # typecheck + build all packages
pnpm --filter @kyomiru/api build      # api only
pnpm --filter @kyomiru/web build      # web only (outputs to apps/web/dist)
pnpm --filter @kyomiru/extension build  # extension (outputs to apps/extension/dist)
```

### Type checking and linting

```bash
pnpm typecheck    # TypeScript validation across all packages
pnpm lint         # ESLint (web only)
pnpm format       # Prettier (writes in place)
```

### Testing

```bash
pnpm test                             # Vitest unit tests across all packages
pnpm --filter @kyomiru/api test       # api unit tests only
pnpm --filter @kyomiru/web e2e        # Playwright end-to-end tests
pnpm --filter @kyomiru/web e2e -- --ui  # Playwright interactive UI
```

### Database

```bash
pnpm db:up          # start Postgres + Redis (Docker, detached)
pnpm db:down        # stop containers
pnpm db:migrate     # apply pending migrations
pnpm db:seed        # seed provider registry (crunchyroll + netflix enabled, prime disabled)
pnpm db:generate    # regenerate Drizzle migration files after schema changes
```

To open a Postgres shell:

```bash
docker exec -it $(docker ps -qf name=postgres) psql -U kyomiru kyomiru
```

### Backfill scripts

These scripts target the compiled `dist/` output — run `pnpm -F @kyomiru/api build` once before invoking them locally.

```bash
pnpm --filter @kyomiru/api cron:run               # enqueue enrichment for shows with no enrichedAt (daily delta)
pnpm --filter @kyomiru/api backfill:enrichment    # re-enqueue enrichment; add --force to reset enrichedAt and re-enqueue all shows
pnpm --filter @kyomiru/api backfill:state         # recompute user_show_state for every (user, show) pair
pnpm --filter @kyomiru/api backfill:translations  # reset enrichedAt for all shows to re-fetch multi-locale titles
pnpm --filter @kyomiru/api backfill:reclassify    # reset enrichedAt for kind='tv' shows to re-classify (e.g. promote Animation)
pnpm --filter @kyomiru/api recompute:airing       # enqueue showRefresh for drifted shows; add --force to enqueue all non-removed shows
pnpm --filter @kyomiru/api merge:scan             # re-enqueue enrichment for shows with no tmdb_id (duplicate-detection safety net)
pnpm --filter @kyomiru/api enrichment:debug <id>  # verbose enrichment diagnostic for a single show (dry-run; add --apply to persist)
pnpm --filter @kyomiru/api queue:status           # snapshot of BullMQ queue depth; add --watch to stream live job events
pnpm --filter @kyomiru/api queue:clean            # drain completed + failed jobs from all queues; --queue --state --waiting to scope
pnpm --filter @kyomiru/api rebuild:show [<showId>] # wipe a show's catalog and replay its watch_events; --scan lists shows with lost progress, --scan --apply bulk-rebuilds
pnpm --filter @kyomiru/api cleanup:phantom-eps    # detect/delete phantom episodes from older catalog shapes; --scan to dry-run, --scan --apply to delete, or pass a <showId> to scope
```

Run `backfill:state` after deploying changes to the status-machine logic or when shows are stuck at `watched` despite a newly-aired season.
Run `backfill:translations` after adding new locales to `ENRICHMENT_LOCALES`.
Run `backfill:reclassify` after upgrading to a release that broadened the animation classifier.
Run `recompute:airing` and `merge:scan` daily via an external scheduler (cron, Kubernetes CronJob, etc.).

### Access control (invite-only)

```bash
pnpm --filter @kyomiru/api approved:add -- user@example.com "optional note"
pnpm --filter @kyomiru/api approved:list
pnpm --filter @kyomiru/api approved:remove -- user@example.com
```

Only relevant when `DISABLE_AUTO_SIGNUP=true`.

### Running one-shot scripts in Docker / Kubernetes

The production API image ships compiled JS at `dist/` — `pnpm` is absent and `tsx` is stripped (devDependency). Use `npm run <script>` instead:

```bash
# Compose
docker compose exec api npm run approved:add -- you@example.com
docker compose exec api npm run backfill:translations

# Kubernetes
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run approved:add -- you@example.com
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run backfill:enrichment
```

## Environment variables

All variables live in `apps/api/.env` (or your deployment platform's env). Use `.env.example` as the template.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `APP_SECRET_KEY` | Yes | 32-byte base64 key for encrypting provider credentials — `openssl rand -base64 32` |
| `SESSION_SECRET` | Yes | Secret for signing session cookies — `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes¹ | Google OAuth client ID ([Google Cloud Console](https://console.cloud.google.com) → OAuth 2.0 Client IDs) |
| `GOOGLE_CLIENT_SECRET` | Yes¹ | Google OAuth client secret |
| `OIDC_REDIRECT_URL` | Yes¹ | OAuth callback URL — must match the Google Console; `http://localhost:3000/api/auth/callback` locally |
| `WEB_ORIGIN` | Yes | Frontend origin, e.g. `http://localhost:5173` |
| `API_ORIGIN` | Yes | API origin, e.g. `http://localhost:3000` |
| `TMDB_API_KEY` | No | TMDb API key — used for all shows (classification, multi-locale titles/descriptions, ratings) |
| `ENRICHMENT_LOCALES` | No | Comma-separated locales for TMDb enrichment. Default: `en-US,ja-JP,es-ES,fr-FR` |
| `ENRICHMENT_CONCURRENCY` | No | Parallel enrichment jobs per worker process. Default: `3` |
| `SHOW_REFRESH_CONCURRENCY` | No | Parallel show-refresh jobs per worker process. Default: `3` |
| `DISABLE_AUTO_SIGNUP` | No | When `true`, only emails in `approved_emails` (or matching `AUTO_SIGNUP_EMAIL_PATTERN`) may sign in. Default: `false` |
| `AUTO_SIGNUP_EMAIL_PATTERN` | No | Glob pattern for auto-approving emails (e.g. `*@company.com`). Only active when `DISABLE_AUTO_SIGNUP=true` |
| `MOCK_GOOGLE_AUTH_USER` | No | **Dev only.** Hitting `/api/auth/google` immediately creates a session for this email, bypassing OIDC. Leave empty in production. |
| `SENTRY_DSN` | No | Sentry DSN for error tracking |
| `PROVIDERS_FIXTURE` | No | Reserved for fixture-driven provider testing |
| `PORT` | No | API port (default: `3000`) |
| `NODE_ENV` | No | `development` or `production` (affects cookie `secure` flag) |

¹ Required unless `MOCK_GOOGLE_AUTH_USER` is set.

## Data model

Two scopes — global catalog data is shared across all users; only watch history and preferences are user-scoped.

**Global (no `user_id`)**
- `providers` — provider registry (crunchyroll, netflix, prime)
- `shows` — canonical show entities enriched from AniList/TMDb
- `show_providers`, `seasons`, `episodes`, `episode_providers` — catalog hierarchy
- `approved_emails` — invite-only access control list (only consulted when `DISABLE_AUTO_SIGNUP=true`)

**User-scoped**
- `users` — Google OIDC accounts; `preferred_locale` stores the user's preferred display language
- `extension_tokens` — long-lived Bearer tokens for the Chrome extension (sha256-hashed at rest, capped at 5 active tokens per user, revocable, `last_used_at` tracked)
- `user_services` — encrypted provider credentials + sync state
- `watch_events` — raw history imported from providers
- `user_episode_progress` — watched/playhead state per episode
- `user_show_state` — derived status (in_progress / new_content / watched / removed), rating, queue position
- `sync_runs` — audit log of every ingest run

### Show status state machine

```
(first ingest)   → in_progress   (partial watch)
(first ingest)   → watched       (100% watched)
in_progress      → watched       (all aired episodes done)
in_progress      → new_content   (≥1 whole aired season has zero watched episodes — whole-season skip rule)
watched          → new_content   (new episode released — the "memory" feature)
new_content      → watched       (user catches up fully)
any              → removed       (user removes; prev_status saved)
removed          → prev_status   (user restores)
```

`new_content` is sticky — it does not flip back to `in_progress` automatically. Only a full catch-up (→ `watched`) or an explicit PATCH clears it. Only aired episodes count (`air_date IS NULL OR air_date <= CURRENT_DATE`), so future seasons do not trigger early. Transitioning to `watched` clears `queue_position`.

## Architecture

### Sync engine

Watch history enters Kyomiru through the Chrome extension (`apps/extension/`). The extension captures the in-browser provider session (Crunchyroll Bearer JWT or Netflix cookies + Shakti metadata), paginates the provider's history API, and streams a normalised payload to `/api/providers/<key>/ingest/{start,chunk,finalize}`. Each provider is implemented as a `ProviderAdapter` in `apps/extension/src/providers/`. The server runs the ingest pipeline synchronously (no queue for sync):

1. Resolve-before-fetch — look up `episode_providers` first; only fetch full show metadata if the show is new to the catalog
2. Upsert `watch_events` and `user_episode_progress` (idempotent)
3. Call `recomputeUserShowState` for each touched show — this is where `watched → new_content` flips happen
4. Enqueue enrichment jobs for new shows (deduplicated by BullMQ job ID)

The ingest pipeline lives in `apps/api/src/services/sync.service.ts` and supports chunked ingest (start / chunk / finalize) for large histories. Two additional BullMQ workers run alongside the sync pipeline: `showRefreshWorker` recomputes `shows.latestAirDate` and fans out `user_show_state` for every library user whenever a show changes (triggered by enrichment, finalize, `recompute:airing`, and merges; jobs deduped by `refresh-<showId>`); `showMergeWorker` collapses two `shows` rows that resolve to the same `tmdb_id` or `anilist_id` into one canonical row, guarded by `pg_advisory_xact_lock`.

### Enrichment

`pnpm --filter @kyomiru/api cron:run` is a one-shot script that calls `enqueuePendingEnrichment`, which enqueues a BullMQ job for every show missing `enriched_at`. There is no in-repo scheduler — invoke it manually or from your deployment platform's scheduler (cron, systemd timer, Fly.io cron, etc.). The `enrichmentWorker` (`apps/api/src/workers/enrichmentWorker.ts`) processes each job: it always calls TMDb first (classification signals + multi-locale titles/descriptions), then calls AniList only when the show is classified as anime. The daily watch-history sync trigger lives in the Chrome extension via `chrome.alarms`, not on the server.

### Credential encryption

Provider credentials are encrypted at rest with AES-256-GCM (Node's built-in `crypto`, implemented in `apps/api/src/crypto/secretbox.ts`) using the 32-byte base64 `APP_SECRET_KEY` master key — 12-byte random nonce, 16-byte auth tag, ciphertext and nonce stored base64 in `user_services.encrypted_secret` / `secret_nonce`. Plaintext exists only in memory during an ingest request; it is never logged (pino redact list covers `body.token`, `encryptedSecret`, and `secretNonce`).

### Resource economics

Shows are stored once globally regardless of how many users watch them. AniList/TMDb API calls scale with unique show count, not user count. Concurrent ingest jobs for the same show are protected by `ON CONFLICT DO NOTHING` inserts.

## API reference

All routes are under `/api`. The web dev server proxies `/api/*` to `:3000`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/google` | Redirect to Google OIDC |
| `GET` | `/api/auth/callback` | OIDC callback; sets session cookie |
| `POST` | `/api/auth/logout` | Clear session |
| `GET` | `/api/me` | Current user profile |
| `PATCH` | `/api/me` | Update `preferredLocale` |
| `GET` | `/api/services` | List providers with connection status |
| `POST` | `/api/services/:provider/test` | Test credentials without saving |
| `POST` | `/api/services/:provider/connect` | Save encrypted credentials |
| `POST` | `/api/services/:provider/disconnect` | Disconnect (data kept) |
| `GET` | `/api/library` | Paginated library (`?q=&status=&sort=&group=`) |
| `GET` | `/api/shows/:id` | Show detail with seasons, episodes, progress |
| `PATCH` | `/api/shows/:id` | Update rating, status, favorite, or queue position |
| `PATCH` | `/api/shows/:showId/episodes/:episodeId` | Update episode progress |
| `POST` | `/api/queue/reorder` | Reorder Watch Queue (`{ showIds: [] }`) |
| `GET` | `/api/new-content-count` | Badge count for New Content tab |
| `GET` | `/api/extension/me` | Current user (extension token auth) |
| `GET` | `/api/extension/tokens` | List active extension tokens |
| `POST` | `/api/extension/tokens` | Create a new extension token |
| `DELETE` | `/api/extension/tokens/:id` | Revoke an extension token |
| `POST` | `/api/providers/:provider/ingest` | Single-shot ingest (full history payload) |
| `POST` | `/api/providers/:provider/ingest/resolve` | Resolve which shows need metadata |
| `POST` | `/api/providers/:provider/ingest/start` | Start a chunked ingest run |
| `POST` | `/api/providers/:provider/ingest/chunk` | Submit a history chunk |
| `POST` | `/api/providers/:provider/ingest/finalize` | Finalize a chunked ingest run |
| `GET` | `/api/healthz` | Health check (`{ ok, db, redis, queues }`) |

## Debugging

### API logs

The API uses structured JSON logging (pino). In development, logs are pretty-printed with colour. Set `LOG_LEVEL=debug` in `.env` for verbose output including SQL queries.

### Inspect the database

```bash
docker exec -it $(docker ps -qf name=postgres) psql -U kyomiru kyomiru

-- Useful queries
SELECT status, count(*) FROM user_show_state GROUP BY status;
SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 5;
SELECT * FROM extension_tokens;
```

### Inspect the queue

```bash
docker exec -it $(docker ps -qf name=redis) redis-cli

KEYS bull:enrichment:*
```

### Health check

```bash
curl http://localhost:3000/api/healthz
# {"ok":true,"db":true,"redis":true,"queues":{...}}
```

## Production deployment

Each app builds to a standalone Docker image:

```bash
docker build -f infra/docker/api.Dockerfile -t kyomiru-api .
docker build -f infra/docker/web.Dockerfile -t kyomiru-web .
```

**Recommended hosting:**
- **API**: Fly.io, Render, or Railway
- **Database**: Neon or Supabase (managed Postgres with `pg_trgm` available)
- **Redis**: Upstash (serverless Redis, BullMQ compatible)
- **Web**: Deploy `apps/web/dist/` to Vercel, Cloudflare Pages, or Netlify; or use the nginx Docker image

Set all required env vars in your deployment platform. `OIDC_REDIRECT_URL`, `WEB_ORIGIN`, and `API_ORIGIN` must reflect the production URLs.
