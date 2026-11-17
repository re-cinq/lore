-- Run with: psql -v team_schemas=a,b,c ... (comma separated, no spaces).
-- A psql variable does not interpolate inside a dollar-quoted block, so it goes
-- through a custom setting first.
SELECT set_config('lore.team_schemas', :'team_schemas', false);

DO $$
DECLARE
  s TEXT;
BEGIN
  FOREACH s IN ARRAY string_to_array(current_setting('lore.team_schemas'), ',')
  LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', s);
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.chunks (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content       TEXT NOT NULL,
        embedding     VECTOR(768),
        content_type  TEXT,
        team          TEXT,
        repo          TEXT,
        file_path     TEXT,
        author        TEXT,
        ingested_at   TIMESTAMPTZ DEFAULT NOW(),
        metadata      JSONB,
        search_tsv    TSVECTOR GENERATED ALWAYS AS (to_tsvector(''english'', regexp_replace(content, ''\(\s*\[(validated|implemented) by [^]]*\]\([^)[:space:]]*\)(\s*(,|;\s*implemented by)\s*\[[^]]*\]\([^)[:space:]]*\))*\s*\)'', '' '', ''g''))) STORED
      )', s);
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_chunks_embedding_idx
      ON %I.chunks USING hnsw (embedding vector_cosine_ops)', s, s);
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_chunks_search_idx
      ON %I.chunks USING GIN (search_tsv)', s, s);
    -- The runtime role reindexes whichever schema a repo resolves to:
    -- per-file re-ingest DELETEs before INSERTing, embedding writes and the
    -- verification sweep UPDATE, orphan pruning DELETEs. A schema granted
    -- less (e.g. only the 0035 migration minimum) fails every write the
    -- moment a repo's team resolves there.
    EXECUTE format('
      GRANT SELECT, INSERT, UPDATE, DELETE ON %I.chunks TO lore', s);
    -- Migrations run as 'lore'; ALTER TABLE/INDEX needs ownership, not just
    -- GRANT ALL. Hand the table (and its indexes) to lore at creation time
    -- so a migration like 0070 (DROP INDEX ... chunks_search_idx) never hits
    -- "must be owner".
    EXECUTE format('
      ALTER TABLE %I.chunks OWNER TO lore', s);
    -- Team schemas created by a bootstrap superuser leave 'lore' (the DB owner,
    -- but not the schema owner) unable to CREATE in them, and the deploy-time
    -- migration runner DDLs these schemas. Mirrors the lore-schema handoff in
    -- ui-helm/migrations/README.md.
    EXECUTE format('GRANT CREATE, USAGE ON SCHEMA %I TO lore', s);
  END LOOP;
END $$;
