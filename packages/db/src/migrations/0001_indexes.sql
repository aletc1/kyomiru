-- Full-text search index on shows (generated column approach via application)
-- We add a tsvector column populated by trigger for FTS
ALTER TABLE shows ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION shows_search_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.canonical_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shows_search_tsv_trigger ON shows;
CREATE TRIGGER shows_search_tsv_trigger
  BEFORE INSERT OR UPDATE ON shows
  FOR EACH ROW EXECUTE FUNCTION shows_search_tsv_update();

CREATE INDEX IF NOT EXISTS shows_search_tsv_idx ON shows USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS shows_title_trgm_idx ON shows USING GIN (title_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shows_year_idx ON shows (year);

-- Partial unique index for watch queue (queue_position unique per user, ignoring removed)
CREATE UNIQUE INDEX IF NOT EXISTS uss_queue_unique
  ON user_show_state (user_id, queue_position)
  WHERE queue_position IS NOT NULL AND status <> 'removed';
