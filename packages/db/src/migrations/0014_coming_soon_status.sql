-- ALTER TYPE ... ADD VALUE inside a transaction requires Postgres 12+; the
-- project targets a newer major, so the migration runner's transaction wrap
-- is fine.
ALTER TYPE show_status ADD VALUE IF NOT EXISTS 'coming_soon' AFTER 'new_content';
