-- Prevent two running sync runs for the same (user, provider) pair.
-- The partial index only covers rows where status='running', so completed
-- and error rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS sync_runs_one_running_per_user_provider
  ON sync_runs(user_id, provider_key)
  WHERE status = 'running';
