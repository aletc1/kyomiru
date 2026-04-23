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
pnpm build            # Build all packages with typecheck
pnpm typecheck        # TypeScript validation across all packages
pnpm lint             # ESLint (web only)
pnpm test             # Run Vitest unit tests
pnpm e2e              # Run Playwright E2E tests
pnpm format           # Prettier formatting

# Single-package commands (use -F flag)
pnpm -F @kyomiru/api test
pnpm -F @kyomiru/web typecheck

# Workers
pnpm -F @kyomiru/api cron:run       # Run the nightly sync cron job manually
pnpm -F @kyomiru/api backfill:enrichment  # Re-enqueue enrichment for all shows
```

## Architecture

This is a **pnpm + Turborepo monorepo** with three apps and four packages.

### Apps

**`apps/api`** — Fastify 5 REST API (Node 20, TypeScript)
- Plugin-based setup in `src/app.ts`; each plugin (`db`, `redis`, `auth`, `enrichmentQueue`) is registered once and decorated onto the Fastify instance
- All routes mounted under `/api` prefix; route files in `src/routes/`
- Two BullMQ workers in `src/workers/`: `syncWorker` (fetches watch history from providers), `enrichmentWorker` (fetches show metadata from AniList/TMDb)
- `src/cron.ts` enqueues sync jobs for all users at 03:15 UTC nightly

**`apps/web`** — React 18 PWA (Vite 6, TanStack Router, TanStack Query)
- File-based routing in `src/routes/`; root layout with auth guard in `__root.tsx`
- Server state via React Query; client state (sidebar open, view mode) via Zustand with `persist` middleware
- `lib/api.ts` is the fetch wrapper (sends credentials); `lib/queryKeys.ts` centralizes query key factory
- Dev proxy: Vite proxies `/api/*` to `localhost:3000`

**`apps/extension`** — Chrome MV3 extension for Crunchyroll watch history capture
- Background worker intercepts Authorization headers to capture the Crunchyroll JWT
- Popup fetches watch history and POSTs normalized payload to the Kyomiru API using an extension token

### Packages

- **`packages/shared`** — Zod schemas (contracts) shared between api and web; single source of truth for request/response shapes
- **`packages/db`** — Drizzle ORM schema + migrations. Key tables: global (`shows`, `episodes`, `seasons`, `show_providers`, `episode_providers`) and user-scoped (`users`, `user_services`, `watch_events`, `user_episode_progress`, `user_show_state`)
- **`packages/providers`** — Enrichment provider abstraction (AniList for anime, TMDb for non-anime)
- **`packages/config`** — Shared TypeScript `tsconfig` presets

### Key Domain Concepts

**Show status state machine:**
- First ingest → `in_progress` (partial watch) or `watched` (all episodes)
- `watched` → `new_content` when a new episode is released (the core feature)
- `new_content` is sticky: it only clears when the user fully catches up (→ `watched`) or explicitly via a PATCH route
- Any status → `removed` (soft delete, `prev_status` preserved for restore)
- Status is recomputed via `recomputeUserShowState()` after every sync and after enrichment upserts new episodes

**Sync flow** (in `syncWorker.ts`):
1. Decrypt provider credentials (libsodium `crypto_secretbox_easy`)
2. Authenticate with provider; abort if credentials are invalid
3. Cursor-based pagination from last sync point
4. Check `episode_providers` before fetching metadata (resolve-before-fetch)
5. Upsert `watch_events` and `user_episode_progress` (idempotent)
6. Recompute `user_show_state` for each touched show
7. Enqueue deduplicated enrichment jobs

**Resource model:** Shows are stored globally (one row per show, not per user). Enrichment API calls scale by unique show count, not by user count.

**Credential encryption:** Provider credentials are encrypted at rest using a 32-byte `APP_SECRET_KEY`. Pino redacts `password`, `username`, and `encryptedSecret` fields from logs.

### Auth

- Google OIDC via `openid-client`; session stored in an encrypted cookie (`@fastify/secure-session`)
- Chrome extension uses a separate long-lived token stored in `users.extension_token`
- CSRF protection enabled for mutating routes

### Environment

All required variables documented in `.env.example`. The API validates its env at startup via Zod in `src/plugins/config.ts`.

### Testing

- Unit tests use Vitest (`*.test.ts` files alongside source)
- E2E tests use Playwright (`apps/web/e2e/`)
- No database mocking — integration tests hit a real Postgres instance
