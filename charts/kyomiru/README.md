# Kyomiru Helm Chart

Deploy Kyomiru to Kubernetes in minutes.

## Prerequisites

| Requirement | Version |
|---|---|
| Kubernetes | ≥ 1.25 |
| Helm | ≥ 3.10 |
| Ingress controller | any (default: ingress-nginx) |
| cert-manager | optional, for automated TLS |

DNS must point your hostname at the ingress controller's external IP before cert-manager can issue a certificate.

## Install

> Replace `X.Y.Z` in the snippets below with the latest tag from [GitHub Releases](https://github.com/aletc1/kyomiru/releases). OCI-published chart versions track the application version.

### Quick start (mock auth, bundled Postgres & Redis)

Suitable for a homelab or local test. No Google Cloud project required.

```bash
helm install kyomiru oci://quay.io/kyomiru/charts/kyomiru \
  --namespace kyomiru --create-namespace \
  --version X.Y.Z \
  --set host=kyomiru.local \
  --set ingress.tls.enabled=false \
  --set app.mockGoogleAuthUser=you@example.com
```

Visit `http://kyomiru.local` and you'll be signed in automatically as `you@example.com`.

> **Warning:** `mockGoogleAuthUser` bypasses all authentication. Anyone who can reach your instance will be signed in as that email. Never set this on a publicly reachable server.

### Production install (Google OAuth + cert-manager TLS)

```bash
helm install kyomiru oci://quay.io/kyomiru/charts/kyomiru \
  --namespace kyomiru --create-namespace \
  --version X.Y.Z \
  --set host=kyomiru.app \
  --set ingress.tls.clusterIssuer=letsencrypt-prod \
  --set app.google.clientId=YOUR_CLIENT_ID \
  --set app.google.clientSecret=YOUR_CLIENT_SECRET \
  --set app.tmdbApiKey=YOUR_TMDB_KEY
```

Or create a `values.yaml` and pass it with `-f`:

```yaml
host: kyomiru.app

ingress:
  tls:
    clusterIssuer: letsencrypt-prod

app:
  google:
    clientId: "YOUR_CLIENT_ID"
    clientSecret: "YOUR_CLIENT_SECRET"
  tmdbApiKey: "YOUR_TMDB_KEY"
```

```bash
helm install kyomiru oci://quay.io/kyomiru/charts/kyomiru \
  --namespace kyomiru --create-namespace \
  --version X.Y.Z \
  -f values.yaml
```

## Configuring Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**.
2. Click **+ Create credentials** → **OAuth 2.0 Client ID**.
3. Application type: **Web application**.
4. **Authorized JavaScript origins**: add `https://kyomiru.app` (your hostname).
5. **Authorized redirect URIs**: add `https://kyomiru.app/api/auth/callback`.
6. Copy the **Client ID** and **Client Secret**.
7. Set them in your values or via `--set app.google.clientId=... --set app.google.clientSecret=...`.

The OIDC redirect URL defaults to `https://<host>/api/auth/callback`. If you need a custom URL, override `app.google.redirectUrl`.

## Secrets

The chart manages a single `Secret` resource containing:

| Key | Description |
|---|---|
| `APP_SECRET_KEY` | 32-byte base64 key used for AES-256-GCM encryption of provider credentials |
| `SESSION_SECRET` | Session cookie signing key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (when set in values) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (when set in values) |
| `TMDB_API_KEY` | TMDb API key (when set in values) |
| `SENTRY_DSN` | Sentry DSN (when set in values) |
| `DATABASE_URL` | External DB URL (when `postgresql.enabled=false` and `externalDatabase.url` is set) |
| `REDIS_URL` | External Redis URL (when `redis.enabled=false` and `externalRedis.url` is set) |

### Auto-generated secrets

If `app.appSecretKey` and `app.sessionSecret` are left blank (the default), the chart generates cryptographically random values at install time and **preserves them across upgrades** via Helm's `lookup` helper. You will never see them in your values file.

To generate them yourself:

```bash
openssl rand -base64 32   # APP_SECRET_KEY
openssl rand -base64 32   # SESSION_SECRET
```

Then set them once:

```bash
helm upgrade kyomiru oci://quay.io/kyomiru/charts/kyomiru \
  --set app.appSecretKey="$(openssl rand -base64 32)" \
  --set app.sessionSecret="$(openssl rand -base64 32)"
```

### Using an external Secret (ExternalSecrets / Sealed Secrets)

Pre-create a Secret with all required keys and reference it:

```yaml
existingSecret: "my-kyomiru-secret"
```

The Secret must contain at minimum: `APP_SECRET_KEY`, `SESSION_SECRET`, and either Google credentials or ensure `MOCK_GOOGLE_AUTH_USER` is set in `app.mockGoogleAuthUser`. When `existingSecret` is set the chart skips creating its own Secret entirely.

## Using External Postgres / Redis

Disable the sub-charts and provide connection strings:

```yaml
postgresql:
  enabled: false

externalDatabase:
  url: "postgresql://kyomiru:password@my-rds.example.com:5432/kyomiru"
  # Or reference an existing Secret:
  # existingSecret: "my-db-secret"
  # existingSecretKey: "database-url"

redis:
  enabled: false

externalRedis:
  url: "redis://my-elasticache.example.com:6379"
```

> Postgres requires the extensions `pgcrypto`, `citext`, `pg_trgm`, and `unaccent` to be available. These ship with every standard Postgres distribution including AWS RDS (enable them by running `CREATE EXTENSION IF NOT EXISTS ...` or via your database provisioning tool). The migration Job handles this automatically on first run.

## TLS

### cert-manager (recommended)

Install cert-manager and create a `ClusterIssuer`, then set:

```yaml
ingress:
  tls:
    clusterIssuer: letsencrypt-prod   # or letsencrypt-staging for testing
    secretName: kyomiru-tls           # cert-manager will create this
```

The chart creates a standalone `Certificate` resource pointing at the `ClusterIssuer`. The `Certificate` is placed in `.Release.Namespace` by default. When `ingress.className` is `istio`, it is placed in `istio-system` instead (where the Istio gateway reads TLS secrets from).

### Manual certificate

Create a TLS Secret yourself and reference it:

```yaml
ingress:
  tls:
    enabled: true
    secretName: my-kyomiru-tls-secret
```

### Disable TLS (HTTP only)

```yaml
ingress:
  tls:
    enabled: false
```

## Database Migrations

Migrations run automatically as a Helm hook (`pre-install` / `pre-upgrade`) before any Deployment rollout. They are idempotent — already-applied migrations are skipped. If the migration Job fails the release fails and the previous state is preserved.

To disable automatic migrations (e.g. you run them out-of-band in a GitOps workflow):

```yaml
migrations:
  enabled: false
```

Run migrations manually:

```bash
kubectl -n kyomiru create job kyomiru-migrate-manual \
  --image=quay.io/kyomiru/migrate:X.Y.Z \
  -- node packages/db/dist/migrate.js
```

## CronJob: Nightly Enrichment

A `CronJob` enqueues metadata enrichment (AniList / TMDb) for any show that hasn't been enriched yet. It runs at 03:00 UTC daily by default.

Override the schedule:

```yaml
cron:
  enrichment:
    schedule: "0 5 * * *"   # 05:00 UTC
```

Disable it entirely:

```yaml
cron:
  enrichment:
    enabled: false
```

Trigger it manually:

```bash
kubectl -n kyomiru create job --from=cronjob/kyomiru-cron-enrichment kyomiru-enrich-now
kubectl -n kyomiru logs -l app.kubernetes.io/component=cron-enrichment --follow
```

## Access Control (invite-only)

By default anyone who can authenticate via Google gets access. To restrict sign-in to a pre-approved list:

```yaml
app:
  disableAutoSignup: true
  # Optional — auto-approve a whole domain without individual entries:
  autoSignupEmailPattern: "*@company.com"
```

Then manage approved emails against the live API pod:

```bash
# Add an email
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run approved:add -- you@example.com

# Add with a note
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run approved:add -- you@example.com "beta tester"

# List all approved emails
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run approved:list

# Remove an email
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run approved:remove -- you@example.com
```

Approval results are cached in Redis for 5 minutes (`auth:approved:<email>`). Removing an entry takes effect within that window without a restart.

## Running Backfills

One-off scripts that re-process existing data. Run them against the live API pod (no extra Job needed):

```bash
# Re-enqueue enrichment for ALL shows (not just unenriched ones):
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run backfill:enrichment

# Recompute user_show_state for all (user, show) pairs:
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run backfill:state

# Reset enrichedAt to re-fetch multi-locale titles from TMDb/AniList:
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run backfill:translations

# Reset enrichedAt for kind='tv' shows to re-classify (e.g. promote Animation to anime):
kubectl -n kyomiru exec deploy/kyomiru-api -- npm run backfill:reclassify
```

Run `backfill:translations` after adding new locales to `app.enrichmentLocales`. Run `backfill:reclassify` once after upgrading to the release containing the Animation classification fix to retroactively promote previously-misclassified shows.

## Upgrading

```bash
helm upgrade kyomiru oci://quay.io/kyomiru/charts/kyomiru \
  --namespace kyomiru \
  --version NEW_VERSION \
  -f values.yaml
```

Migrations run automatically before the new pods start. Image tags default to the chart's `appVersion`, so the chart version and application version move together.

To pin a specific image version independently:

```yaml
image:
  api:
    tag: "1.2.0"
  web:
    tag: "1.2.0"
  migrate:
    tag: "1.2.0"
```

## Uninstalling

```bash
helm uninstall kyomiru --namespace kyomiru
```

> **Note:** Bitnami sub-chart PersistentVolumeClaims are **not** deleted by `helm uninstall`. To fully clean up:
> ```bash
> kubectl -n kyomiru delete pvc --all
> ```
> This will permanently delete your database and Redis data.

## Connecting the Chrome Extension

Once Kyomiru is running:

1. Download `kyomiru-extension-vX.Y.Z.zip` from the [latest GitHub Release](https://github.com/aletc1/kyomiru/releases/latest).
2. Unzip it, then in Chrome go to `chrome://extensions` → enable **Developer Mode** → **Load unpacked** → select the unzipped folder.
3. In the extension popup, set your Kyomiru URL to `https://kyomiru.app`.
4. Generate an extension token at `https://kyomiru.app/settings/extension` (after signing in).
5. Paste the token into the extension popup.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 502 Bad Gateway on `/api/*` | API pod not ready | `kubectl -n kyomiru get pods` — check api pod logs |
| Google OIDC redirect loop | Wrong redirect URI in Google Console | Verify `app.google.redirectUrl` matches what's in Google Cloud Console |
| Session cookie not set | TLS not terminated or `NODE_ENV != production` | Ensure HTTPS and `app.nodeEnv: production` |
| Extension gets CORS error | Your origin isn't allowed | Extension origins (`chrome-extension://...`) are always allowed; check that `host` in values matches your actual URL |
| Postgres connection refused | Migration Job hit wrong host | Confirm `postgresql.enabled` matches whether you have the sub-chart; check `externalDatabase.url` |
| `dial tcp: lookup kyomiru-redis-master` | Redis Service name changed | Run `kubectl -n kyomiru get svc` and verify the redis master service name |

Check the API health endpoint:

```bash
kubectl -n kyomiru port-forward svc/kyomiru-api 3000:3000
curl http://localhost:3000/api/healthz
# {"ok":true,"db":true,"redis":true}
```

## Configuring Quay.io (maintainers)

The `release.yml` workflow publishes the chart to `oci://quay.io/kyomiru/charts`. The robot account needs **Write** permission on the `kyomiru/charts` OCI repository in [quay.io](https://quay.io). Use the same `QUAY_USERNAME` / `QUAY_PASSWORD` secrets already configured for the image builds.

## Values Reference

See [`values.yaml`](./values.yaml) for a fully commented list of all options.
