-- Seed the Netflix provider row.
--
-- Migration 0007_enable_netflix.sql ran an UPDATE on `key = 'netflix'` assuming
-- the row existed, but no prior migration ever inserted it (only Crunchyroll was
-- seeded in 0002). The UPDATE was therefore a silent no-op on every existing
-- database, leaving the row absent. Any attempt to write `user_services`,
-- `show_providers`, `episode_providers`, or `sync_runs` with `provider_key =
-- 'netflix'` then fails the foreign-key constraint:
--   user_services_provider_key_fkey
--
-- This migration inserts the missing row idempotently with the final shape
-- previously established by 0006 (URL templates) and 0007 (enabled + episode
-- template).
INSERT INTO providers (key, display_name, enabled, kind, show_url_template, episode_url_template)
VALUES (
  'netflix',
  'Netflix',
  true,
  'general',
  'https://www.netflix.com/title/{externalId}',
  'https://www.netflix.com/watch/{externalId}'
)
ON CONFLICT (key) DO UPDATE SET
  enabled              = EXCLUDED.enabled,
  show_url_template    = EXCLUDED.show_url_template,
  episode_url_template = EXCLUDED.episode_url_template;
