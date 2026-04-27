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

# One-shot API scripts (require pnpm build first; target compiled dist/)
pnpm -F @kyomiru/api cron:run                         # Enqueue enrichment for shows with no enrichedAt (daily delta — no force flag)
pnpm -F @kyomiru/api backfill:enrichment              # Enqueue enrichment for shows with no enrichedAt; add --force to reset enrichedAt and re-enqueue all shows
pnpm -F @kyomiru/api backfill:state                   # Recompute user_show_state for all users
pnpm -F @kyomiru/api backfill:translations            # Reset enrichedAt for all shows to re-fetch multi-locale titles
pnpm -F @kyomiru/api backfill:reclassify              # Reset enrichedAt for kind='tv' shows to re-classify (e.g. promote Animation to anime)
pnpm -F @kyomiru/api recompute:airing                 # Enqueue showRefresh for drifted shows; add --force to enqueue all non-removed shows regardless of drift
pnpm -F @kyomiru/api approved:add <email> [note]      # Add email to the approved_emails table
pnpm -F @kyomiru/api approved:remove <email>          # Remove email from approved_emails table
pnpm -F @kyomiru/api approved:list                    # List all approved emails
pnpm -F @kyomiru/api enrichment:debug <showId>        # Verbose enrichment diagnostic for a single show (dry-run; add --apply to persist)
pnpm -F @kyomiru/api queue:status                     # Snapshot of BullMQ queue depth (waiting/active counts); add --watch to stream live job events
pnpm -F @kyomiru/api queue:clean                      # Drain completed + failed jobs from all queues; --queue=<name> --state=<state> --waiting to scope
pnpm -F @kyomiru/api merge:scan                       # Re-enqueue enrichment for shows with no tmdb_id; add --force to ignore the 5-attempt retry cap
pnpm -F @kyomiru/api rebuild:show <showId>            # Wipe a show's catalog and replay its watch_events through the adopt-on-miss path; --scan to list shows with lost progress, --scan --apply to bulk-rebuild them
pnpm -F @kyomiru/api cleanup:phantom-eps              # Detect and delete phantom episodes left over from older catalog shapes (no provider, no progress, same title as a higher-season episode); --scan to dry-run, --scan --apply to delete, or pass a <showId> to scope to one show
```

The Docker Compose file lives at `infra/compose/docker-compose.dev.yml`.

## Architecture

This is a **pnpm + Turborepo monorepo** with three apps and four packages.

### Apps

**`apps/api`** — Fastify 5 REST API (Node 20, TypeScript, ESM)
- Plugin setup in `src/app.ts` (in order): `configPlugin`, `@fastify/cors` (allowlists `WEB_ORIGIN` and any `chrome-extension://` origin), `@fastify/rate-limit` (60 req/min), `@fastify/secure-session` (30-day cookie, `SameSite=Lax`), `dbPlugin`, `redisPlugin`, `enrichmentQueuePlugin`, `showRefreshQueuePlugin`, `showMergeQueuePlugin`, `authPlugin`, `errorHandlerPlugin`. `ZodError → 400` is mapped in `errorHandler`.
- Routes under `/api` prefix: `auth`, `me` (GET + PATCH `preferredLocale`), `services`, `library`, `shows`, `queue`, `newContent`, `extension`, `providers`, `healthz`.
- `src/util/locale.ts` — `pickLocalized(map, locales, fallback)` and `resolveRequestLocales(acceptLanguage, preferredLocale)` used by library and show routes to serve titles/descriptions in the request locale.
- **Three** BullMQ workers:
  - `src/workers/enrichmentWorker.ts` (concurrency 3) — always calls TMDb first (classification signals + multi-locale titles/descriptions), then AniList when the show is classified as anime. `classifyKind` (`src/services/classifyKind.ts`) promotes `tv→anime` on any TMDb genre containing "anim" (Animation, Anime, Animated, …) — Western cartoons are included by design — or on a high-confidence AniList match (≥ 0.9). The `anime` kind is Kyomiru's catch-all for animated TV; the web UI surfaces it as "Animation". 7-day freshness short-circuit on `shows.enrichedAt`. When a newly-discovered season is upserted, it enqueues a `showRefresh` job for fanout. When another show already owns the proposed `tmdb_id`/`anilist_id`, it enqueues a `showMerge` job to collapse the duplicate row.
  - `src/workers/showRefreshWorker.ts` (concurrency 3) — single pipeline for "show changed" events. Refreshes `shows.latestAirDate` and recomputes `user_show_state` for every library user. Triggered by enrichment, sync ingest finalize, the `recompute:airing` script, and show merges. Jobs deduped by `refresh-<showId>`. The state machine (`src/services/stateMachine.ts`) only counts episodes where `air_date IS NULL OR air_date <= CURRENT_DATE` toward `total`, so currently-airing shows reach `coming_soon` (caught up, more scheduled) or `watched` (no future eps) and flip to `new_content` when a future ep crosses today and grows the catalog.
  - `src/workers/showMergeWorker.ts` (concurrency 2) — collapses two `shows` rows that map to the same `tmdb_id` or `anilist_id` into one canonical row. Migrates `show_providers`, seasons, episodes, `episode_providers`, `user_episode_progress`, and `user_show_state` in a single transaction guarded by a `pg_advisory_xact_lock`. Triggered by enrichment conflict detection; also runs via the `merge:scan` safety-net script. Jobs scoped to `(kind, externalId, duplicateShowId)` so multiple duplicates of the same show each get their own job. After merging, enqueues `showRefresh` for the canonical show.
- Sync runs **inline** in `src/services/sync.service.ts` — not as a worker — via the extension-driven ingest protocol (see *Sync flow* below).
- `src/cron.ts` is a one-shot script that enqueues enrichment jobs for shows with `enrichedAt IS NULL`. There is no in-repo scheduler; the daily sync trigger lives in the extension (`chrome.alarms`).
- Library search is a hybrid: FTS branch uses `shows.search_tsv @@ websearch_to_tsquery('simple', immutable_unaccent(q))` (GIN index `shows_search_tsv_idx`; trigger rebuilt in migration 0009 to cover all JSONB locale values); fuzzy branch uses `word_similarity(lower(immutable_unaccent(q)), shows.search_normalized) > 0.3` (GIN trigram index `shows_search_normalized_trgm_idx`). `search_normalized` is a lowercased, accent-stripped concatenation of `canonical_title` + all locale title values, maintained by the same trigger as `search_tsv`. `immutable_unaccent` is a stable SQL wrapper around `unaccent('unaccent', $1)` added in migration 0012. Per-database `pg_trgm.word_similarity_threshold = 0.3` is set by that same migration. Kind filter uses `COALESCE(kindOverride, kind)`.

**`apps/web`** — React 18 PWA (Vite 6, TanStack Router, TanStack Query)
- File-based routing in `src/routes/`; session guard in `__root.tsx`. Route tree auto-generated to `src/routeTree.gen.ts`.
- Styling: Tailwind 3 with shadcn-style primitives built on Radix UI (`src/components/ui/`). Icons via `lucide-react`, toasts via `sonner`, forms via `react-hook-form` + Zod, drag-and-drop (queue reorder) via `@dnd-kit`, list virtualization via `@tanstack/react-virtual`.
- Server state via React Query; `src/lib/queryKeys.ts` centralizes the key factory. Client state via Zustand in `src/lib/store.ts` (`sidebarOpen`, `viewMode`) — **only `viewMode` is persisted**.
- `src/lib/api.ts` is the fetch wrapper (`credentials: 'include'`, auto JSON body, surfaces `{ error }` from the server).
- PWA via `vite-plugin-pwa` with Workbox: images `CacheFirst`, `/api/*` `NetworkFirst` (5s network timeout).
- Dev proxy: Vite proxies `/api/*` to `localhost:3000`.

**`apps/extension`** — Chrome MV3 extension for multi-provider watch-history sync (Crunchyroll, Netflix)
- `src/providers/types.ts` defines the `ProviderAdapter` interface; `src/providers/index.ts` holds the registry. Each adapter encapsulates everything provider-specific: session capture, history pagination, catalog fetch (if available), and `IngestItem`/`IngestShow` construction.
- `src/background.ts` service worker registers a `webRequest` listener per adapter that declares `onRequest` (currently Crunchyroll only, for Bearer JWT capture). Netflix uses cookie auth — no listener needed. `chrome.alarms` schedules `kyomiru-daily-sync` every 24 h; the alarm iterates all adapters and syncs those with a valid session.
- `src/sync.ts` drives the streaming ingest protocol against the Kyomiru API using a Bearer extension token. The extension is the only thing that talks to Crunchyroll or Netflix — the API never does.
- Popup (`src/popup.ts`) detects the active tab's URL, shows the matching provider's card first, and falls back to listing all adapters on unrecognised pages.
- Build: custom `scripts/build.mjs` (no Vite/webpack). Vitest for unit tests.

### Packages

- **`packages/shared`** — Zod contracts (`auth`, `ingest`, `library`, `services`, `shows`, `sync`) shared by api/web/extension. Single source of truth for request/response shapes.
- **`packages/db`** — Drizzle ORM schema + raw SQL migrations. Global tables: `providers`, `shows` (has JSONB `titles`, `descriptions` locale maps; `search_tsv` tsvector covering all locales; `search_normalized` text for trigram fuzzy search), `show_providers`, `seasons` (JSONB `titles`), `episodes` (JSONB `titles`, `descriptions`), `episode_providers`, `approved_emails` (invite-only access control list). User-scoped: `users` (has `preferred_locale`), `user_services`, `watch_events`, `user_episode_progress`, `user_show_state` (carries `prev_status`, `queue_position`, `rating`, `kind_override`), `sync_runs`, `content_hashes`, `extension_tokens`. Exports `@kyomiru/db/client` and `@kyomiru/db/schema`.
- **`packages/providers`** — **Enrichment** provider abstraction only: AniList (`AniListMatch` has `canonicalTitle` + `titles: Record<string,string>` for en/ja/ja-Latn), TMDb (`TMDbMatch` has `originalLanguage`, `originCountry`; `fetchTMDbShowTree` accepts `locales[]` and uses `append_to_response=translations` for a single-round-trip locale map). Watch-history extraction lives in the extension, not here.
- **`packages/config`** — Shared TypeScript `tsconfig` presets.

### Key Domain Concepts

**Show status state machine** (`apps/api/src/services/stateMachine.ts`):

Five statuses: `in_progress`, `new_content`, `coming_soon`, `watched`, `removed`. `decideShowStatus` reads four signals derived from the user's progress against the show's episodes:

- `total` — count of episodes that pass the aired filter (`air_date IS NULL OR air_date <= CURRENT_DATE`).
- `watched` — count of those that have a `user_episode_progress.watched=true` row for this user.
- `hasActionable` — there exists an episode the user can watch *right now*: `air_date IS NOT NULL AND <= CURRENT_DATE` AND not yet watched.
- `hasUpcoming` — there exists an episode the user *can't watch yet*: either `air_date > CURRENT_DATE`, OR `air_date IS NULL` with no `episode_providers` row (an enrichment placeholder for an announced-but-unscheduled future episode). NULL eps that *do* have a provider row come from extension history-only ingest (Netflix) and are treated as aired-but-undated, not upcoming.
- `latestAiredSeasonUnwatched` — the highest-numbered season with any aired episode has zero watched episodes for this user.

Branches, in priority order:
1. `T == W && !hasUpcoming` → `watched` (fully caught up, nothing scheduled).
2. `T == W && hasUpcoming` → `coming_soon` (caught up, more is coming).
3. `T > W && !hasActionable && hasUpcoming && W > 0` → `coming_soon` (placeholder-padded shows: user is caught up on every dated released ep but `T > W` because of NULL placeholders or future-dated eps).
4. `existingStatus ∈ {watched, coming_soon} && hasActionable && T > existingTotalEpisodes` → `new_content` (a new dated episode appeared, catalog grew).
5. `existingStatus == new_content && hasActionable` → `new_content` (sticky while there's something to watch).
6. `W > 0 && hasActionable && latestAiredSeasonUnwatched` → `new_content` (user has started the show; the *latest* aired season is wholly unwatched — only the latest is checked, so skipping earlier seasons doesn't trigger this).
7. Otherwise → `in_progress`.

Other rules:
- `removed` is a soft delete. `recomputeUserShowState` won't overwrite it; it only refreshes the counters. `prev_status` exists as a column for future restore logic.
- Status is recomputed after every ingest, after enrichment upserts new episodes, and after a `showRefresh` job. Transitioning to `watched` clears `queue_position` (other statuses preserve it).
- The aired filter treats `air_date IS NULL` as aired (so extension history-only eps count toward `total`), but `hasUpcoming` only re-classifies a NULL as "upcoming" when no `episode_providers` row exists — this is the discriminator between an enrichment placeholder and a Netflix-style undated watched ep.

**Sync flow** — streaming, extension-driven (runs per provider key):
1. Extension reads the adapter's captured session from `chrome.storage.session` (`capturedSession:<providerKey>`); aborts if missing or expired.
2. `POST /api/providers/:key/ingest/start` opens a `sync_runs` row. On HTTP 409 (a prior running run exists), the extension auto-finalizes it and retries once.
3. `POST /api/providers/:key/ingest/resolve` with all show ids → server returns per-show `{ known, catalogSyncedAt, seasonCoverage }` via `resolveShowCatalogStatus`. Shows with sufficient server coverage go through a **fast path** (items-only chunks); the rest go through a **slow path** that first fetches the provider catalog in the extension. Crunchyroll fetches seasons+episodes via `/content/v2/cms`; Netflix yields no catalogs and instead synthesises a history-only show tree (the same fallback path that fires when a Crunchyroll catalog fetch fails). This is the resolve-before-fetch pattern.
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
- **Invite-only gate**: `DISABLE_AUTO_SIGNUP=true` restricts sign-in to the `approved_emails` table. `AUTO_SIGNUP_EMAIL_PATTERN` (glob, e.g. `*@company.com`) auto-approves matching emails without a table row. `isEmailApproved` (`src/services/authGate.ts`) is called by `requireAuth`, `requireExtensionAuth`, and the OIDC `signInAs` callback; result cached in Redis at `auth:approved:<email>` (5-min TTL). Manage entries with the `approved:{add,remove,list}` scripts.
- CORS is origin-allowlisted (`WEB_ORIGIN` + `chrome-extension://*`); rate limit is 60 req/min. **No CSRF middleware is currently registered** — the `@fastify/csrf-protection` dep is present but unused; the session cookie is `SameSite=Lax`.

### Environment

All variables documented in `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `APP_SECRET_KEY`, `SESSION_SECRET`, `WEB_ORIGIN`, `API_ORIGIN`, plus Google OIDC creds (unless `MOCK_GOOGLE_AUTH_USER` is set). Optional: `TMDB_API_KEY`, `ENRICHMENT_LOCALES` (comma-separated, default `en-US,ja-JP,es-ES,fr-FR`), `DISABLE_AUTO_SIGNUP` (default `false`), `AUTO_SIGNUP_EMAIL_PATTERN` (glob, only active when `DISABLE_AUTO_SIGNUP=true`), `SENTRY_DSN`, `PROVIDERS_FIXTURE`. Validation is done by Zod in `src/plugins/env.ts`; `src/plugins/config.ts` is the Fastify wrapper that decorates `app.config`.

### Testing

- Unit tests: Vitest (`*.test.ts` alongside source in `apps/api`, `apps/web`, `apps/extension`).
- E2E: Playwright in `apps/web/e2e/`.
- No database mocking — api integration tests hit a real Postgres instance.

## Release process

Releases are automated via [release-please](https://github.com/googleapis/release-please). Config: `release-please-config.json`. Workflow: `.github/workflows/release.yml`.

### How a release happens

1. Every push to `main` re-runs release-please, which scans commits since the last release tag.
2. If at least one commit is user-visible (`feat`, `fix`, or anything with `!`), release-please opens or updates a single **Release PR** titled `chore(main): release X.Y.Z`. This PR bumps `package.json` and `apps/extension/manifest.json`, regenerates `CHANGELOG.md`, and waits.
3. Merging the Release PR creates the `vX.Y.Z` git tag and a GitHub Release, which triggers:
   - Multi-arch (amd64 + arm64) image builds pushed to `quay.io/kyomiru/{api,web,migrate}` with tags `:X.Y.Z`, `:X.Y`, `:X`, `:latest`, `:sha-<short>`.
   - `kyomiru-extension-vX.Y.Z.zip` attached to the release as a download artifact.
4. PRs that only touch `chore:` / `refactor:` / `docs:` / `ci:` / `test:` do not produce a release.

### Commit / PR title conventions

This repo uses **squash-merge** — the PR title becomes the commit on `main` and is what release-please parses. Every PR title must match [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope][!]: <short description>
```

| Prefix | Example | Version bump | When to use |
|---|---|---|---|
| `feat:` | `feat(web): add drag-and-drop queue reorder` | **minor** (0.2.0 → 0.3.0) | New user-visible feature |
| `fix:` | `fix(api): stop double-enqueuing enrichment` | **patch** (0.2.0 → 0.2.1) | Bug fix |
| `perf:` | `perf(sync): batch progress upserts` | **patch** | Performance improvement |
| `feat!:` / `fix!:` | `feat(api)!: replace /library with /v2/library` | **major** (0.2.0 → 1.0.0) | Breaking change |
| `revert:` | `revert: feat(web): drag-and-drop queue` | matches reverted | Reverts a previous commit |
| `docs:` / `chore:` / `refactor:` / `test:` / `build:` / `ci:` / `style:` | `chore(deps): bump zod to 3.24` | **none** | No user-visible change |

Additional rules:
- Breaking changes (`!`) **must** include a `BREAKING CHANGE:` paragraph in the PR body describing what breaks and how to migrate. release-please pastes this into the changelog.
- Scope is optional but recommended when the change is localised. Valid scopes mirror the workspace: `api`, `web`, `extension`, `db`, `shared`, `providers`, `infra`, `deps`.
- Title format: imperative mood, lowercase after the colon, no trailing period, ≤ 72 chars.
- When a PR contains multiple logically separate changes, prefer splitting it into two PRs. If that is impractical, pick the highest-severity type for the title.

### What Claude should do when creating a PR

- Classify the change before writing the title: is this a new capability a self-hoster would notice (`feat`), a bug that was observable (`fix`), or purely internal (`chore` / `refactor`)?
- Any change to an env var name, a migration, a public API contract (routes, request/response shapes in `packages/shared`), or the extension ingest protocol is a **breaking change** — use `!` and write a `BREAKING CHANGE:` block.
- When uncertain between `feat` and `chore`, ask: "would a self-hoster want this in their upgrade notes?" If yes → `feat`. If no → `chore`.
- Never open or edit a Release PR — release-please owns it. Fix the source commits on `main` if the Release PR shows the wrong version.
