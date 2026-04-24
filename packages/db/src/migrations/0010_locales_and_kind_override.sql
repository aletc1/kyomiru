-- Locale maps for multi-language title/description storage.
-- Existing scalar columns (canonical_title, description, seasons.title, episodes.title)
-- stay and are mirrored into the JSONB maps during this migration.
ALTER TABLE shows    ADD COLUMN IF NOT EXISTS titles       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE shows    ADD COLUMN IF NOT EXISTS descriptions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE seasons  ADD COLUMN IF NOT EXISTS titles       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS titles       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS descriptions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- User content-language preference (null = derive from Accept-Language).
ALTER TABLE users           ADD COLUMN IF NOT EXISTS preferred_locale text;
-- Per-user kind override; when set, wins over shows.kind in the UI.
ALTER TABLE user_show_state ADD COLUMN IF NOT EXISTS kind_override    show_kind;

-- Backfill existing rows: seed the JSONB maps from the scalar columns.
UPDATE shows
   SET titles       = jsonb_build_object('en', canonical_title),
       descriptions = CASE WHEN description IS NOT NULL
                           THEN jsonb_build_object('en', description)
                           ELSE '{}'::jsonb END
 WHERE titles = '{}'::jsonb;

UPDATE seasons
   SET titles = jsonb_build_object('en', title)
 WHERE titles = '{}'::jsonb AND title IS NOT NULL;

UPDATE episodes
   SET titles = jsonb_build_object('en', title)
 WHERE titles = '{}'::jsonb AND title IS NOT NULL;

-- Rebuild the FTS trigger to cover all locale values, not just English.
-- 'simple' dictionary avoids applying English stemming to Japanese/Spanish/French.
CREATE OR REPLACE FUNCTION shows_search_tsv_update() RETURNS trigger AS $$
DECLARE
  title_blob text;
  desc_blob  text;
BEGIN
  SELECT string_agg(value, ' ') INTO title_blob FROM jsonb_each_text(NEW.titles);
  SELECT string_agg(value, ' ') INTO desc_blob  FROM jsonb_each_text(NEW.descriptions);

  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.canonical_title, '') || ' ' || coalesce(title_blob, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description,     '') || ' ' || coalesce(desc_blob,  '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Force the trigger to re-fire for all existing rows so search_tsv picks up
-- the JSONB locale data backfilled above.
UPDATE shows SET canonical_title = canonical_title;
