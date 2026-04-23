-- Track when the Crunchyroll catalog tree (seasons + episodes) was last
-- uploaded for a given show, so the extension can skip redundant fetches.
ALTER TABLE show_providers ADD COLUMN IF NOT EXISTS catalog_synced_at timestamptz;
