# Contributing

## Before opening a PR

All three checks must pass:

```bash
pnpm typecheck   # TypeScript validation across all packages
pnpm lint        # ESLint
pnpm test        # Vitest unit tests
```

**PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/)** — this repo uses squash-merge, so the PR title becomes the commit on `main` and drives automated versioning via release-please.

```
<type>[optional scope][!]: <short description>
```

Quick reference: `feat:` → minor bump, `fix:` → patch bump, `feat!:` / `fix!:` → major bump (breaking change). `chore:`, `refactor:`, `docs:`, `ci:`, `test:` produce no release. See [CLAUDE.md §Release process](./CLAUDE.md#release-process) for the full table and rules.

## Adding a streaming provider

Both current providers (Crunchyroll and Netflix) use the **browser-captured** pattern — the server never holds long-lived provider credentials; all history fetching happens inside the Chrome extension using the user's active browser session.

### Browser-captured provider (primary path)

1. **Add the key** to `PROVIDER_KEYS` and `EXTENSION_PROVIDER_KEYS` in `packages/shared/src/types/status.ts`.
2. **Implement a `ProviderAdapter`** in `apps/extension/src/providers/<name>.ts`. The interface is defined in `apps/extension/src/providers/types.ts`. Use `crunchyroll.ts` as the reference — it covers session capture, history pagination, catalog fetch, and `IngestItem`/`IngestShow` construction.
3. **Register the adapter** in `apps/extension/src/providers/index.ts`.
4. **Seed the provider** — add an `enabled: true` row in `packages/db/src/seed.ts`.

The server side is handled automatically: `EXTENSION_PROVIDER_KEYS` drives the `INGEST_ENABLED_PROVIDERS` set in `apps/api/src/routes/providers.routes.ts`, so the streaming ingest endpoints (`start`, `chunk`, `finalize`, `resolve`) become available for the new key without further changes.

### Server-side polling (legacy / not currently used)

If you ever need a provider where the server holds credentials and polls the API directly (rather than capturing from the browser), the `Provider` interface in `packages/providers/src/types.ts` and the `PROVIDER_INSTANCES` map in `apps/api/src/routes/services.routes.ts` are the extension points. No provider currently uses this path.
