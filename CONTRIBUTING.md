# Contributing

## Before opening a PR

All three checks must pass:

```bash
pnpm typecheck   # TypeScript validation across all packages
pnpm lint        # ESLint
pnpm test        # Vitest unit tests
```

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `chore:`, etc.).

## Adding a streaming provider

Providers that can be implemented as a background service (credential-based polling) follow this path:

1. **Add the key** to `PROVIDER_KEYS` in `packages/shared/src/types/status.ts`.
2. **Implement the `Provider` interface** under `packages/providers/src/<name>/provider.ts`.
3. **Add fixtures** under `packages/providers/test/fixtures/` for unit tests.
4. **Register ingest handlers** in `apps/api/src/routes/providers.routes.ts` (the `INGEST_ENABLED_PROVIDERS` set and any provider-specific mapping).
5. **Register connect/test/disconnect** in `apps/api/src/routes/services.routes.ts` (the `PROVIDER_INSTANCES` map).
6. **Seed the provider** — add an `enabled: true` row in `packages/db/src/seed.ts`.

For browser-captured providers (where the server never holds long-lived credentials, as with Crunchyroll), the ingest side lives in the Chrome extension instead of a background worker. Use `apps/extension/` and `apps/extension/README.md` as the reference implementation.
