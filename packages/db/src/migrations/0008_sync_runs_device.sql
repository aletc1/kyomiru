-- Attribute each sync run to the extension device (token) that triggered it.
-- Nullable so legacy rows and cron-triggered runs are unaffected.
ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS extension_token_id uuid
    REFERENCES extension_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sync_runs_token_idx
  ON sync_runs(extension_token_id);
