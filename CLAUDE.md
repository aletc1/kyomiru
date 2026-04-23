# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev              # Start all apps (api + web) via Turborepo
pnpm db:up            # Start Postgres + Redis via Docker Compose (required before dev)
pnpm db:down          # Stop Docker services

# Database
pnpm db:migrate       # Apply pending Drizzle migrations
pnpm db:generate      # Generate new migrations from schema changes
pnpm db:seed          # Seed with sample data

# Quality
pnpm build            # Build all packages (each package runs tsc)
pnpm typecheck        # TypeScript validation across all packages
pnpm lint             # ESLint (web only)
pnpm test             # Run Vitest unit tests
pnpm e2e              # Run Playwright E2E tests
pnpm format           # Prettier formatting

# Single-package commands (use -F flag)
pnpm -F @kyomiru/api test
pnpm -F @kyomiru/web typecheck

# One-shot API scripts (not scheduled in-repo)
pnpm -F @kyomiru/api cron:run               # Enqueue enrichment for shows with no enrichedAt
pnpm -F @kyomiru/api backfill:enrichment    # Re-enqueue enrichment for all shows
pnpm -F @kyomiru/api backfill:state         # Recompute user_show_state for all users
```

The Docker Compose file lives at `infra/compose/docker-compose.dev.yml`.

## Architecture

This is a **pnpm + Turborepo monorepo** with three apps and four packages.

### Apps

**`apps/api`** — Fastify 5 REST API (Node 20, TypeScript, ESM)
- Plugin setup in `src/app.ts` (in order): `configPlugin`, `@fastify/cors` (allowlists `WEB_ORIGIN` and any `chrome-extension://` origin), `@fastify/rate-limit` (60 req/min), `@fastify/secure-session` (30-day cookie, `SameSite=Lax`), `dbPlugin`, `redisPlugin`, `enrichmentQueuePlugin`, `authPlugin`, `errorHandlerPlugin`. `ZodError → 400` is mapped in `errorHandler`.
- Routes under `/api` prefix: `auth`, `me`, `services`, `library`, `shows`, `queue`, `newContent`, `extension`, `providers`. `healthz` is mounted at root.
- **One** BullMQ worker in `src/workers/enrichmentWorker.ts`: AniList-first for anime with TMDb fallback, 7-day freshness short-circuit on `shows.enrichedAt`, concurrency 3. When a newly-discovered season is upserted, it fans out a state recompute to every user that has the show in their library.
- Sync runs **inline** in `src/services/sync.service.ts` — not as a worker — via the extension-driven ingest protocol (see *Sync flow* below).
- `src/cron.ts` is a one-shot script that enqueues enrichment jobs for shows with `enrichedAt IS NULL`. There is no in-repo scheduler; the daily sync trigger lives in the extension (`chrome.alarms`).

**`apps/web`** — React 18 PWA (Vite 6, TanStack Router, TanStack Query)
- File-based routing in `src/routes/`; session guard in `__root.tsx`. Route tree auto-generated to `src/routeTree.gen.ts`.
- Styling: Tailwind 3 with shadcn-style primitives built on Radix UI (`src/components/ui/`). Icons via `lucide-react`, toasts via `sonner`, forms via `react-hook-form` + Zod, drag-and-drop (queue reorder) via `@dnd-kit`, list virtualization via `@tanstack/react-virtual`.
- Server state via React Query; `src/lib/queryKeys.ts` centralizes the key factory. Client state via Zustand in `src/lib/store.ts` (`sidebarOpen`, `viewMode`) — **only `viewMode` is persisted**.
- `src/lib/api.ts` is the fetch wrapper (`credentials: 'include'`, auto JSON body, surfaces `{ error }` from the server).
- PWA via `vite-plugin-pwa` with Workbox: images `CacheFirst`, `/api/*` `NetworkFirst` (5s network timeout).
- Dev proxy: Vite proxies `/api/*` to `localhost:3000`.

**`apps/extension`** — Chrome MV3 extension for Crunchyroll watch-history sync
- `src/background.ts` service worker observes `chrome.webRequest.onBeforeSendHeaders` on `*.crunchyroll.com/*`, captures the Bearer JWT, and extracts the profile id from `/content/v2/<uuid>/…` (UUID-validated so namespace segments like `discover` are not captured as a profile id).
- `chrome.alarms` schedules `kyomiru-daily-sync` every 24h so the library refreshes without the user opening the popup.
- `src/sync.ts` drives the streaming ingest protocol against the Kyomiru API using a Bearer extension token. The extension is the only thing that talks to Crunchyroll — the API never does.
- Build: custom `scripts/build.mjs` (no Vite/webpack). Vitest for unit tests.

### Packages

- **`packages/shared`** — Zod contracts (`auth`, `ingest`, `library`, `services`, `shows`, `sync`) shared by api/web/extension. Single source of truth for request/response shapes.
- **`packages/db`** — Drizzle ORM schema + raw SQL migrations. Global tables: `providers`, `shows`, `show_providers`, `seasons`, `episodes`, `episode_providers`. User-scoped: `users`, `user_services`, `watch_events`, `user_episode_progress`, `user_show_state` (carries `prev_status`, `queue_position`, `rating`), `sync_runs`, `content_hashes`, `extension_tokens`. Exports `@kyomiru/db/client` and `@kyomiru/db/schema`.
- **`packages/providers`** — **Enrichment** provider abstraction only: AniList (anime), TMDb (non-anime / fallback). Watch-history extraction lives in the extension, not here.
- **`packages/config`** — Shared TypeScript `tsconfig` presets.

### Key Domain Concepts

**Show status state machine** (`apps/api/src/services/stateMachine.ts`):
- First ingest → `in_progress` (partial watch) or `watched` (all episodes)
- `watched` → `new_content` when `total > userShowState.totalEpisodes` and user is behind (a new season/episode appeared)
- `new_content` is sticky: it clears only when the user fully catches up (→ `watched`) or explicitly via a PATCH route
- `removed` is a soft delete. `recomputeUserShowState` will not overwrite `removed`; it only refreshes the episode counters. `prev_status` exists as a column for future restore logic.
- Status is recomputed after every ingest and after enrichment upserts new episodes. Transitioning to `watched` clears `queue_position`.

**Sync flow** — streaming, extension-driven:
1. Extension reads a captured Crunchyroll JWT from `chrome.storage`; aborts if missing.
2. `POST /api/providers/:key/ingest/start` opens a `sync_runs` row. On HTTP 409 (a prior running run exists), the extension auto-finalizes it and retries once.
3. `POST /api/providers/:key/ingest/resolve` with all series ids → server returns per-series `{ known, catalogSyncedAt, seasonCoverage }` via `resolveShowCatalogStatus`. Series with sufficient server coverage go through a **fast path** (items-only chunks); the rest go through a **slow path** that first fetches the Crunchyroll catalog in the extension. This is the resolve-before-fetch pattern.
4. Streaming `POST /api/providers/:key/ingest/chunk` with `{ items, shows }`. Server upserts `watch_events`, `seasons`/`episodes`/`episode_providers` (idempotent `ON CONFLICT DO NOTHING`), and `user_episode_progress`. Touched show ids and counter deltas are accumulated in Redis (`kyomiru:sync:<key>:<runId>:*`, 1h TTL).
5. `POST /api/providers/:key/ingest/finalize` → server recomputes `user_show_state` for every touched show, bumps `user_services.last_sync_at`, and marks the run `success`.
6. The extension checkpoints progress to `chrome.storage` between chunks so a service-worker restart resumes without refetching history.

**Resource model:** Shows are stored globally (one row per show, not per user). Enrichment API calls scale with unique show count.

**Credential / secret handling:**
- `apps/api/src/crypto/secretbox.ts` uses **AES-256-GCM** (Node's built-in `crypto`): 32-byte base64 key in `APP_SECRET_KEY`, 12-byte random nonce, 16-byte auth tag. Ciphertext and nonce are stored base64 in `user_services.encrypted_secret` / `secret_nonce`.
- Pino redacts `body.token`, `encryptedSecret`, `secretNonce` (`apps/api/src/util/logger.ts`).

### Auth

- **Session auth** (web): Google OIDC via `openid-client`; session in an encrypted cookie (`@fastify/secure-session`). Route guard: `app.requireAuth`.
- **Extension auth**: Bearer token in the `extension_tokens` table (sha256-hashed at rest, cap 5 active per user, revocable, `last_used_at` tracked). Route guard: `app.requireExtensionAuth`.
- **Dev bypass**: setting `MOCK_GOOGLE_AUTH_USER=<email>` short-circuits OIDC and drops a session for that user.
- CORS is origin-allowlisted (`WEB_ORIGIN` + `chrome-extension://*`); rate limit is 60 req/min. **No CSRF middleware is currently registered** — the `@fastify/csrf-protection` dep is present but unused; the session cookie is `SameSite=Lax`.

### Environment

All variables documented in `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `APP_SECRET_KEY`, `SESSION_SECRET`, `WEB_ORIGIN`, `API_ORIGIN`, plus Google OIDC creds (unless `MOCK_GOOGLE_AUTH_USER` is set). Optional: `TMDB_API_KEY`, `SENTRY_DSN`, `PROVIDERS_FIXTURE`. Validation is done by Zod in `src/plugins/env.ts`; `src/plugins/config.ts` is the Fastify wrapper that decorates `app.config`.

### Testing

- Unit tests: Vitest (`*.test.ts` alongside source in `apps/api`, `apps/web`, `apps/extension`).
- E2E: Playwright in `apps/web/e2e/`.
- No database mocking — api integration tests hit a real Postgres instance.
