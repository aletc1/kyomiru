-- GIN index on shows.genres (text[]) for fast array containment queries.
-- Enables shows.genres @> ARRAY['Drama']::text[] used by the library genre filter
-- and the unnest-based genre facets query.
CREATE INDEX IF NOT EXISTS shows_genres_gin_idx ON shows USING GIN (genres);
