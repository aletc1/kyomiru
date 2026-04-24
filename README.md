# Kyomiru

[![CI](https://github.com/aletc1/kyomiru/actions/workflows/ci.yml/badge.svg)](https://github.com/aletc1/kyomiru/actions/workflows/ci.yml)
[![Release](https://github.com/aletc1/kyomiru/actions/workflows/release.yml/badge.svg)](https://github.com/aletc1/kyomiru/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/aletc1/kyomiru?sort=semver)](https://github.com/aletc1/kyomiru/releases/latest)
[![License: AGPL v3](https://img.shields.io/github/license/aletc1/kyomiru)](./LICENSE)

Kyomiru (kyō + miru, "today I watch") is a self-hostable PWA for tracking your anime and TV show watch history. It acts as a memory layer — surfacing shows you already finished that suddenly have new episodes out.

## Features

- **Library** — searchable grid/list of everything you've watched, grouped by status
- **In Progress** — shows started but not finished
- **New Content** — finished shows with newly released episodes (the core "memory" feature)
- **Watched** — fully consumed shows
- **Removed** — soft-deleted shows, restorable at any time
- **Watch Queue** — drag-and-drop prioritised list of shows to watch next
- **Multi-language content** — show, season, and episode titles/descriptions stored in up to four locales (en-US, ja-JP, es-ES, fr-FR); served in the user's preferred language
- **Automatic anime reclassification** — shows imported as `tv` (e.g. Netflix) are promoted to `anime` when TMDB signals Japanese origin + Animation genre, or when AniList returns a high-confidence match; per-user kind override available
- **Nightly enrichment** — automated metadata refresh from AniList and TMDb, now multi-locale
- **PWA** — installable on desktop and mobile; offline library via service worker

## Tech stack

React 18 · Vite 6 · TanStack Router + Query · TailwindCSS · ShadCN UI  
Node 20 · Fastify 5 · Drizzle ORM · PostgreSQL 16 · Redis + BullMQ  
pnpm workspaces + Turborepo · AniList + TMDb (metadata enrichment)

## Quick start

```bash
pnpm install
cp .env.example apps/api/.env   # then fill in the required values — see DEVELOPMENT.md
pnpm db:up                       # start Postgres + Redis in Docker
pnpm db:migrate && pnpm db:seed  # create tables and seed provider registry
pnpm dev                         # api on :3000, web on :5173
```

See [`.env.example`](./.env.example) for the full variable list and [DEVELOPMENT.md](./DEVELOPMENT.md) for deeper setup notes.

## Self-hosting

Kyomiru ships prebuilt multi-arch (amd64 + arm64) images to [quay.io/kyomiru](https://quay.io/organization/kyomiru). The repo-root [`docker-compose.yml`](./docker-compose.yml) spins everything up.

### 5-minute setup

```bash
git clone https://github.com/aletc1/kyomiru
cd kyomiru
cp .env.self-host.example .env
# Edit .env — at minimum set APP_SECRET_KEY, SESSION_SECRET, and either
# MOCK_GOOGLE_AUTH_USER (quick) or Google OAuth credentials (proper auth).
docker compose up -d
open http://localhost:8080
```

See [`.env.self-host.example`](./.env.self-host.example) for every self-host variable and [`docker-compose.yml`](./docker-compose.yml) for the full service topology.

### Required environment variables

| Variable | What it is | How to generate |
|---|---|---|
| `APP_SECRET_KEY` | 32-byte base64 key for encrypting provider credentials at rest (AES-256-GCM) | `openssl rand -base64 32` |
| `SESSION_SECRET` | Signs the session cookie | `openssl rand -base64 32` |
| `MOCK_GOOGLE_AUTH_USER` **or** `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `OIDC_REDIRECT_URL` | Authentication — pick one mode | See below |

### Auth modes

- **Zero-config (LAN / homelab)** — uncomment `MOCK_GOOGLE_AUTH_USER=you@example.com` in `.env`. Visiting `/api/auth/google` instantly creates a session for that email with no Google Cloud project required. Do not expose this instance to the public internet while this is set.
- **Proper Google OAuth** — create an OAuth 2.0 Client in [Google Cloud Console](https://console.cloud.google.com), add your origin to *Authorised JavaScript origins* and `<origin>/api/auth/callback` to *Authorised redirect URIs*, then fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OIDC_REDIRECT_URL`.

### Optional variables

| Variable | Purpose |
|---|---|
| `TMDB_API_KEY` | TMDb metadata enrichment for non-anime shows — [get one free](https://www.themoviedb.org/settings/api) |
| `ENRICHMENT_LOCALES` | Comma-separated locales fetched from TMDb during enrichment. Defaults to `en-US,ja-JP,es-ES,fr-FR` |
| `KYOMIRU_VERSION` | Pin a release tag (e.g. `0.2.1`). Defaults to `latest` |
| `KYOMIRU_PORT` | Host port for the web container. Defaults to `8080` |
| `SENTRY_DSN` | Error reporting |

### Kubernetes (Helm)

Deploy to any Kubernetes cluster with a single command:

```bash
# Replace X.Y.Z with the latest tag from https://github.com/aletc1/kyomiru/releases
helm install kyomiru oci://quay.io/kyomiru/charts/kyomiru \
  --namespace kyomiru --create-namespace \
  --version X.Y.Z \
  --set host=kyomiru.app \
  --set ingress.tls.clusterIssuer=letsencrypt-prod \
  --set app.google.clientId=YOUR_CLIENT_ID \
  --set app.google.clientSecret=YOUR_CLIENT_SECRET
```

The chart bundles Bitnami PostgreSQL and Redis sub-charts (opt-out via `postgresql.enabled=false` / `redis.enabled=false` to use managed services). Migrations run automatically as a Helm hook. A `CronJob` handles nightly metadata enrichment.

See [charts/kyomiru/README.md](./charts/kyomiru/README.md) for the full guide covering Google OAuth setup, TLS, external databases, backfills, and more.

### Configuring Quay.io secrets (for maintainers publishing images)

1. In [quay.io](https://quay.io), create a **robot account** under the `kyomiru` org with *Write* permission on `kyomiru/api`, `kyomiru/web`, `kyomiru/migrate`, and `kyomiru/charts`.
2. Copy the robot name (e.g. `kyomiru+github_actions`) and its Docker CLI token.
3. In GitHub → *Settings → Secrets and variables → Actions*, add two repository secrets:
   - `QUAY_USERNAME` = the robot name
   - `QUAY_PASSWORD` = the Docker CLI token

The [`release.yml`](./.github/workflows/release.yml) workflow reads these automatically on every release to push images and the Helm chart OCI artifact.

### Connect the Chrome extension

Download `kyomiru-extension-vX.Y.Z.zip` from the [latest GitHub Release](../../releases/latest), unzip it, then in Chrome go to `chrome://extensions` → enable *Developer Mode* → *Load unpacked* → select the unzipped folder. In the popup, enter your Kyomiru URL (e.g. `http://localhost:8080`) and an extension token generated at `<your-kyomiru>/settings/extension`.

### Running behind a reverse proxy (HTTPS)

Point Caddy / Traefik / nginx at `web:80` of the compose stack. Update `WEB_ORIGIN`, `API_ORIGIN`, and `OIDC_REDIRECT_URL` in `.env` to your public HTTPS origin.

## Chrome extension

Watch history is imported via the Kyomiru Chrome extension, which captures your in-browser session for supported providers (Crunchyroll and Netflix) and POSTs normalised history to your Kyomiru instance. See [apps/extension/README.md](./apps/extension/README.md).

## Documentation

| Document | Contents |
|---|---|
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Setup, commands, env vars, data model, architecture, API reference, debugging, deployment |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Commit style, pre-PR checks, adding a streaming provider |
| [charts/kyomiru/README.md](./charts/kyomiru/README.md) | Kubernetes / Helm chart: install, Google OAuth, TLS, external DB/Redis, upgrades |
| [apps/extension/README.md](./apps/extension/README.md) | Chrome extension: how it works, build, install |

## License

[AGPL-3.0](./LICENSE)
