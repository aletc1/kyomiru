-- ─── Provider: Crunchyroll ──────────────────────────────────────────────────
INSERT INTO providers (key, display_name, enabled, kind)
VALUES ('crunchyroll', 'Crunchyroll', true, 'anime')
ON CONFLICT (key) DO NOTHING;

-- ─── User: Chrome extension API tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS extension_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text        NOT NULL UNIQUE,
  label         text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS extension_tokens_user_idx ON extension_tokens (user_id);
