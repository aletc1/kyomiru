-- Persist the external metadata id + rating pulled from TMDb/AniList so
-- subsequent enrichment runs skip the search step and we can detect new
-- seasons/episodes against the current catalogue.
ALTER TABLE shows ADD COLUMN IF NOT EXISTS tmdb_id    integer;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS anilist_id integer;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS rating     numeric(3,1);

CREATE UNIQUE INDEX IF NOT EXISTS shows_tmdb_id_idx
  ON shows (tmdb_id)    WHERE tmdb_id    IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shows_anilist_id_idx
  ON shows (anilist_id) WHERE anilist_id IS NOT NULL;
