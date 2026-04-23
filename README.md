# Kyomiru

Kyomiru (kyō + miru, "today I watch"), is a self-hostable PWA for tracking your anime and TV show watch history across streaming services. Kyomiru is designed around a pluggable provider abstraction (Netflix, Prime Video, etc.), syncs your watch history, and acts as a memory layer — surfacing old shows that suddenly have new episodes to watch.

> **Note**: Crunchyroll was the MVP provider but has been removed — their unofficial API requires rotating client credentials and browser-session tokens that make unattended sync unreliable. The provider abstraction remains in place for future integrations.

## Features

- **Library** — searchable grid/list of everything you've watched, grouped by status
- **In Progress** — shows you've started but haven't finished
- **New Content** — previously-finished shows with newly released episodes (the "memory" feature)
- **Watched** — fully consumed shows
- **Removed** — soft-deleted shows that can be restored at any time
- **Watch Queue** — a drag-and-drop prioritised list of shows you want to watch next
- **Sync** — manual button + nightly cron that pulls your history from connected services
- **Services** — connect/disconnect providers; credentials stored encrypted at rest
- **PWA** — installable on desktop and mobile; offline library reading via service worker

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, TailwindCSS, ShadCN UI, TanStack Router + Query |
| Backend | Node 20, Fastify 5, TypeScript, Drizzle ORM |
| Database | PostgreSQL 16 (FTS, trigram, JSONB) |
| Queue | Redis + BullMQ |
| Auth | Google OIDC (openid-client), encrypted session cookies |
| Providers | Pluggable abstraction (no live providers currently implemented); AniList (metadata), TMDb (metadata) |
| Monorepo | pnpm workspaces + Turborepo |

## Repository layout

```
kyomiru/
├── apps/
│   ├── api/        Node.js Fastify backend + BullMQ workers
│   └── web/        React 18 PWA
├── packages/
│   ├── shared/     Zod contracts shared by api and web
│   ├── db/         Drizzle schema, migrations, seed
│   ├── providers/  Provider abstraction + AniList, TMDb enrichment
│   └── config/     Shared tsconfig presets
├── infra/
│   ├── compose/    docker-compose.dev.yml (Postgres + Redis)
│   └── docker/     Production Dockerfiles + nginx config
└── .env.example
```

---

## Getting started

### Prerequisites

- **Node 20** (use `nvm use` — `.nvmrc` is included)
- **pnpm 10** — `npm install -g pnpm`
- **Docker** — for the local Postgres + Redis containers

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example apps/api/.env
```

Edit `apps/api/.env` and fill in:

| Variable | How to get it |
|---|---|
| `APP_SECRET_KEY` | `openssl rand -base64 32` |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Same as above |
| `TMDB_API_KEY` | [themoviedb.org](https://www.themoviedb.org/settings/api) (optional — used for non-anime metadata enrichment) |

For Google OAuth, set the **Authorised redirect URI** to `http://localhost:3000/api/auth/callback`.

### 3. Start infrastructure

```bash
pnpm db:up          # starts Postgres and Redis in Docker (detached)
```

### 4. Run database migrations and seed

```bash
pnpm db:migrate     # runs SQL migrations (creates all tables + indexes)
pnpm db:seed        # inserts provider registry (Netflix, Prime — disabled by default)
```

### 5. Start development servers

```bash
pnpm dev
```

This runs both `apps/api` (port **3000**) and `apps/web` (port **5173**) in parallel via Turborepo. The web Vite dev server proxies `/api/*` to the API automatically.

Open [http://localhost:5173](http://localhost:5173).

---

## Common commands

### Development

```bash
pnpm dev                          # start api + web in watch mode
pnpm --filter @kyomiru/api dev    # api only
pnpm --filter @kyomiru/web dev    # web only
```

### Building

```bash
pnpm build                        # typecheck + build all packages
pnpm --filter @kyomiru/api build  # api only
pnpm --filter @kyomiru/web build  # web only (outputs to apps/web/dist)
```

### Type checking

```bash
pnpm typecheck                    # typecheck all packages in dependency order
```

### Linting & formatting

```bash
pnpm lint                         # ESLint across all packages
pnpm format                       # Prettier (writes in place)
```

### Testing

```bash
pnpm test                         # unit tests across all packages (Vitest)
pnpm --filter @kyomiru/api test   # api unit tests only
pnpm --filter @kyomiru/web test   # web unit tests only
pnpm --filter @kyomiru/web e2e    # Playwright end-to-end tests
```

> **Tip:** run `pnpm --filter @kyomiru/web e2e -- --ui` to open the Playwright interactive UI.

### Database

```bash
pnpm db:up          # start Postgres + Redis (Docker)
pnpm db:down        # stop containers
pnpm db:migrate     # apply pending migrations
pnpm db:seed        # seed provider registry
pnpm db:generate    # regenerate Drizzle migration files after schema changes
```

To open a Postgres shell:

```bash
docker exec -it $(docker ps -qf name=postgres) psql -U kyomiru kyomiru
```

### Trigger a sync manually (cron dry-run)

```bash
pnpm --filter @kyomiru/api cron:run
```

Enqueues one sync job per user that has connected credentials. Useful for testing the nightly scheduler locally.

### Backfill scripts

```bash
pnpm --filter @kyomiru/api backfill:enrichment   # re-enqueue enrichment for shows missing enriched_at
pnpm --filter @kyomiru/api backfill:state        # recompute user_show_state for every (user, show) pair
```

Run `backfill:state` after deploying fixes that change status-machine logic or when a catalog has grown but users' statuses are stale (e.g. shows stuck at `watched` despite a newly-aired season existing in `episodes`).

---

## Environment variables reference

All variables live in `apps/api/.env` (or real env in production). See `.env.example` for the full list.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `APP_SECRET_KEY` | Yes | 32-byte base64 key for encrypting provider credentials |
| `SESSION_SECRET` | Yes | Secret for signing session cookies |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `OIDC_REDIRECT_URL` | Yes | OAuth callback URL (must match Google Console) |
| `WEB_ORIGIN` | Yes | Frontend origin (e.g. `http://localhost:5173`) |
| `API_ORIGIN` | Yes | API origin (e.g. `http://localhost:3000`) |
| `TMDB_API_KEY` | No | TMDb API key for non-anime metadata enrichment |
| `PROVIDERS_FIXTURE` | No | Reserved for future fixture-driven provider testing |
| `SENTRY_DSN` | No | Sentry DSN for error tracking |
| `PORT` | No | API port (default: `3000`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

---

## Data model overview

Two scopes — global catalog data is shared across all users; only watch history and preferences are user-scoped:

**Global (shared, no `user_id`)**
- `providers` — provider registry (netflix, prime)
- `shows` — canonical show entities enriched from AniList/TMDb
- `show_providers`, `seasons`, `episodes`, `episode_providers` — catalog hierarchy

**User-scoped**
- `users` — Google OIDC accounts
- `user_services` — encrypted provider credentials + sync state
- `watch_events` — raw history imported from providers
- `user_episode_progress` — rolled-up watched/playhead per episode
- `user_show_state` — derived status (in_progress / new_content / watched / removed), rating, queue position
- `sync_runs` — audit log of every sync job

### Show status state machine

```
(first ingest)       → in_progress  (partial watch)
(first ingest)       → watched      (100% watched)
in_progress          → watched      (all episodes done)
watched              → new_content  (new episode released — the "memory" feature)
new_content          → in_progress  (user starts watching new episode)
any                  → removed      (user removes; prev_status saved)
removed              → prev_status  (user restores)
```

---

## API overview

All routes are under `/api`. The frontend proxies `/api/*` to `localhost:3000` in dev.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/google` | Redirect to Google OIDC |
| `GET` | `/api/auth/callback` | OIDC callback; sets session cookie |
| `POST` | `/api/auth/logout` | Clear session |
| `GET` | `/api/me` | Current user profile |
| `GET` | `/api/services` | List all providers with connection status |
| `POST` | `/api/services/:provider/test` | Test credentials without saving |
| `POST` | `/api/services/:provider/connect` | Save encrypted credentials + connect |
| `POST` | `/api/services/:provider/disconnect` | Disconnect (keeps all data) |
| `POST` | `/api/sync` | Trigger sync for connected providers |
| `GET` | `/api/sync/latest` | Last 10 sync run statuses |
| `GET` | `/api/library` | Paginated library (`?q=&status=&sort=&group=`) |
| `GET` | `/api/shows/:id` | Show detail with seasons, episodes, progress |
| `PATCH` | `/api/shows/:id` | Update rating, status, favorite, queue position |
| `POST` | `/api/queue/reorder` | Reorder Watch Queue (`{ showIds: [] }`) |
| `GET` | `/api/new-content-count` | Badge count for New Content tab |
| `GET` | `/healthz` | Health check (`{ ok, db, redis }`) |

---

## Architecture notes

### Sync engine

Sync jobs run in BullMQ (Redis-backed queue). The flow per job:

1. Decrypt provider credentials from `user_services`
2. Authenticate with the provider; abort if credentials invalid
3. Stream history pages (cursor-based, stops when reaching the previous sync cursor)
4. For each watched item — **resolve-before-fetch**: look up `episode_providers` first; only fetch full show metadata from the provider if the show is new to the catalog
5. Upsert `watch_events` and `user_episode_progress` (idempotent)
6. Call `recomputeUserShowState` for each touched show — this is where `watched → new_content` flips happen
7. Enqueue enrichment jobs for new shows (single-flight: deduplicated by `show_id`)

The nightly cron (`pnpm --filter @kyomiru/api cron:run`) enqueues one job per connected `user_services` row at `03:15 UTC`.

### Credential encryption

Provider usernames/passwords are encrypted with `libsodium` `crypto_secretbox_easy` using a master key from `APP_SECRET_KEY`. Plaintext exists only in memory during a test or sync; it is never logged (pino redact list covers `password`, `username`, `encryptedSecret`).

### Resource economics

The same anime/show is stored **once** in the global catalog regardless of how many users watch it. Provider API calls and AniList/TMDb enrichment scale with unique shows, not with user count. Concurrent sync jobs for the same show are protected by `ON CONFLICT DO NOTHING` inserts; enrichment is deduplicated by BullMQ job ID.

---

## Debugging

### API logs

The API uses structured JSON logging (pino). In development, logs are pretty-printed with colour. Set `LOG_LEVEL=debug` in `.env` for verbose output including all SQL queries.

### Inspect the database

```bash
# psql shell
docker exec -it $(docker ps -qf name=postgres) psql -U kyomiru kyomiru

# Useful queries
SELECT status, count(*) FROM user_show_state GROUP BY status;
SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 5;
SELECT * FROM user_services;
```

### Inspect the queue

```bash
# Redis CLI
docker exec -it $(docker ps -qf name=redis) redis-cli

# List queued jobs
KEYS bull:sync:*
KEYS bull:enrichment:*
```

### Health check

```bash
curl http://localhost:3000/healthz
# {"ok":true,"db":true,"redis":true}
```

---

## Production deployment

Each app builds to a standalone Docker image.

```bash
# Build images
docker build -f infra/docker/api.Dockerfile -t kyomiru-api .
docker build -f infra/docker/web.Dockerfile -t kyomiru-web .
```

**Recommended providers:**
- **API**: [Fly.io](https://fly.io), [Render](https://render.com), [Railway](https://railway.app)
- **Database**: [Neon](https://neon.tech) or [Supabase](https://supabase.com) (managed Postgres with `pg_trgm` available)
- **Redis**: [Upstash](https://upstash.com) (serverless Redis, BullMQ compatible)
- **Web**: Deploy the `dist/` folder to any static host (Vercel, Cloudflare Pages, Netlify), or use the nginx Docker image

Set all required env vars in your deployment platform. `OIDC_REDIRECT_URL`, `WEB_ORIGIN`, and `API_ORIGIN` must reflect the production URLs. For reference, the official Kyomiru instance is hosted at `kyomiru.app`.

---

## Contributing

This project uses Conventional Commits. Before submitting a PR:

```bash
pnpm typecheck   # must pass
pnpm lint        # must pass
pnpm test        # must pass
```

### Adding a new streaming provider

1. Add its key to `PROVIDER_KEYS` in `packages/shared/src/types/status.ts`
2. Create `packages/providers/src/<name>/provider.ts` implementing the `Provider` interface
3. Add a fixture under `packages/providers/test/fixtures/`
4. Register the provider in `src/routes/services.routes.ts` and `src/workers/syncWorker.ts` in `apps/api`
5. Insert an enabled row into the `providers` table via a new seed or migration

---

## License

MIT — see [LICENSE](./LICENSE).
