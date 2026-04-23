-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Enums
DO $$ BEGIN
  CREATE TYPE show_status    AS ENUM ('in_progress', 'new_content', 'watched', 'removed');
  CREATE TYPE service_status AS ENUM ('connected', 'disconnected', 'error');
  CREATE TYPE sync_status    AS ENUM ('running', 'success', 'partial', 'error');
  CREATE TYPE sync_trigger   AS ENUM ('manual', 'cron');
  CREATE TYPE match_source   AS ENUM ('provider_primary', 'anilist_match', 'tmdb_match', 'manual');
  CREATE TYPE show_kind      AS ENUM ('anime', 'tv', 'movie');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Global: providers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS providers (
  key          text    PRIMARY KEY,
  display_name text    NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  kind         text    NOT NULL DEFAULT 'general'
);

-- ─── User accounts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub    text        NOT NULL UNIQUE,
  email         citext      NOT NULL UNIQUE,
  display_name  text        NOT NULL,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- ─── Per-user provider credentials ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_services (
  user_id          uuid           NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  provider_key     text           NOT NULL REFERENCES providers(key) ON DELETE RESTRICT,
  status           service_status NOT NULL DEFAULT 'disconnected',
  encrypted_secret text,
  secret_nonce     text,
  last_tested_at   timestamptz,
  last_sync_at     timestamptz,
  last_error       text,
  last_cursor      jsonb,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_key)
);

-- ─── Global: shows ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shows (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_title     text        NOT NULL,
  title_normalized    text        NOT NULL,
  description         text,
  cover_url           text,
  year                integer,
  kind                show_kind   NOT NULL DEFAULT 'tv',
  genres              text[]      NOT NULL DEFAULT '{}',
  latest_air_date     date,
  enriched_at         timestamptz,
  enrichment_attempts integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── Global: show ↔ provider mapping ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS show_providers (
  show_id          uuid         NOT NULL REFERENCES shows(id)     ON DELETE CASCADE,
  provider_key     text         NOT NULL REFERENCES providers(key) ON DELETE RESTRICT,
  external_id      text         NOT NULL,
  match_source     match_source NOT NULL DEFAULT 'provider_primary',
  match_confidence numeric(4,3),
  raw_metadata     jsonb,
  PRIMARY KEY (show_id, provider_key, external_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS show_providers_external_idx
  ON show_providers (provider_key, external_id);

-- ─── Global: seasons ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id       uuid    NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  season_number integer NOT NULL,
  title         text,
  air_date      date,
  episode_count integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS seasons_show_number_idx ON seasons (show_id, season_number);
CREATE        INDEX IF NOT EXISTS seasons_show_idx        ON seasons (show_id);

-- ─── Global: episodes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episodes (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id        uuid    NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  show_id          uuid    NOT NULL REFERENCES shows(id)   ON DELETE CASCADE,
  episode_number   integer NOT NULL,
  title            text,
  duration_seconds integer,
  air_date         date
);

CREATE UNIQUE INDEX IF NOT EXISTS episodes_season_number_idx ON episodes (season_id, episode_number);
CREATE        INDEX IF NOT EXISTS episodes_show_idx          ON episodes (show_id);
CREATE        INDEX IF NOT EXISTS episodes_air_date_idx      ON episodes (air_date);

-- ─── Global: episode ↔ provider mapping ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS episode_providers (
  episode_id   uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  provider_key text NOT NULL REFERENCES providers(key),
  external_id  text NOT NULL,
  PRIMARY KEY (episode_id, provider_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS episode_providers_external_idx
  ON episode_providers (provider_key, external_id);

-- ─── User: raw watch events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watch_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  provider_key     text        NOT NULL REFERENCES providers(key),
  external_item_id text        NOT NULL,
  watched_at       timestamptz NOT NULL,
  playhead_seconds integer,
  duration_seconds integer,
  fully_watched    boolean,
  raw              jsonb       NOT NULL,
  ingested_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS watch_events_natural_key
  ON watch_events (user_id, provider_key, external_item_id, watched_at);
CREATE        INDEX IF NOT EXISTS watch_events_user_time_idx
  ON watch_events (user_id, watched_at DESC);

-- ─── User: rolled-up episode progress ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_episode_progress (
  user_id          uuid        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  episode_id       uuid        NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  playhead_seconds integer     NOT NULL DEFAULT 0,
  watched          boolean     NOT NULL DEFAULT false,
  watched_at       timestamptz,
  last_event_at    timestamptz NOT NULL,
  PRIMARY KEY (user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS uep_user_watched_idx ON user_episode_progress (user_id, watched);

-- ─── User: derived show state ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_show_state (
  user_id          uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  show_id          uuid        NOT NULL REFERENCES shows(id)  ON DELETE CASCADE,
  status           show_status NOT NULL,
  prev_status      show_status,
  rating           smallint    CHECK (rating BETWEEN 1 AND 5),
  favorited_at     timestamptz,
  queue_position   integer,
  total_episodes   integer     NOT NULL DEFAULT 0,
  watched_episodes integer     NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id)
);

CREATE        INDEX IF NOT EXISTS uss_user_status_idx    ON user_show_state (user_id, status);
CREATE        INDEX IF NOT EXISTS uss_user_activity_idx  ON user_show_state (user_id, last_activity_at DESC);
CREATE        INDEX IF NOT EXISTS uss_user_favorited_idx ON user_show_state (user_id, queue_position);

-- ─── User: sync audit log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  provider_key   text         NOT NULL REFERENCES providers(key),
  trigger        sync_trigger NOT NULL,
  status         sync_status  NOT NULL DEFAULT 'running',
  started_at     timestamptz  NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  items_ingested integer      NOT NULL DEFAULT 0,
  items_new      integer      NOT NULL DEFAULT 0,
  cursor_before  jsonb,
  cursor_after   jsonb,
  errors         jsonb
);

CREATE INDEX IF NOT EXISTS sync_runs_user_time_idx ON sync_runs (user_id, started_at DESC);

-- ─── User: content hash fallback delta ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_hashes (
  user_id      uuid        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  provider_key text        NOT NULL REFERENCES providers(key),
  scope        text        NOT NULL,
  hash         text        NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_key, scope)
);
