# Kyomiru

Kyomiru (kyō + miru, "today I watch") is a self-hostable PWA for tracking your anime and TV show watch history. It acts as a memory layer — surfacing shows you already finished that suddenly have new episodes out.

## Features

- **Library** — searchable grid/list of everything you've watched, grouped by status
- **In Progress** — shows started but not finished
- **New Content** — finished shows with newly released episodes (the core "memory" feature)
- **Watched** — fully consumed shows
- **Removed** — soft-deleted shows, restorable at any time
- **Watch Queue** — drag-and-drop prioritised list of shows to watch next
- **Nightly enrichment** — automated metadata refresh from AniList and TMDb
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

## Crunchyroll extension

Watch history is imported via the Kyomiru Chrome extension, which captures the in-browser Crunchyroll JWT and POSTs normalised history to your Kyomiru instance. See [apps/extension/README.md](./apps/extension/README.md).

## Documentation

| Document | Contents |
|---|---|
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Setup, commands, env vars, data model, architecture, API reference, debugging, deployment |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Commit style, pre-PR checks, adding a streaming provider |
| [apps/extension/README.md](./apps/extension/README.md) | Chrome extension: how it works, build, install |

## License

[AGPL-3.0](./LICENSE)
