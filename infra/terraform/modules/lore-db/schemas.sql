-- ---------------------------------------------------------------------------
-- Schema-per-team DDL
-- Creates 5 team schemas, each with an identical chunks table plus indexes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  schema_name TEXT;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['payments', 'platform', 'mobile', 'data', 'org_shared']
  LOOP
    -- Create the schema
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

    -- Chunks table with embedding, full-text search, and metadata
    EXECUTE format($sql$
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
        search_tsv    TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
      )
    $sql$, schema_name);

    -- ScaNN index for approximate-nearest-neighbor vector search
    EXECUTE format($sql$
      CREATE INDEX IF NOT EXISTS chunks_embedding_scann_idx
        ON %I.chunks USING scann (embedding vector_cosine_ops)
        WITH (num_leaves = 64)
    $sql$, schema_name);

    -- GIN index for full-text search
    EXECUTE format($sql$
      CREATE INDEX IF NOT EXISTS chunks_search_tsv_gin_idx
        ON %I.chunks USING GIN (search_tsv)
    $sql$, schema_name);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Pipeline extension tables for eval, autoresearch, and context core tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pipeline.eval_runs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team       TEXT NOT NULL,
  pass_rate  DOUBLE PRECISION NOT NULL,
  total_tests INTEGER NOT NULL,
  passed     INTEGER NOT NULL,
  failed     INTEGER NOT NULL,
  run_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline.research_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id   TEXT NOT NULL,
  namespace    TEXT NOT NULL,
  approach     TEXT NOT NULL,
  content      TEXT NOT NULL,
  eval_score   DOUBLE PRECISION,
  delta        DOUBLE PRECISION,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline.context_core_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     TEXT NOT NULL,
  namespace   TEXT NOT NULL,
  eval_score  DOUBLE PRECISION NOT NULL,
  status      TEXT NOT NULL DEFAULT 'candidate',
  promoted_at TIMESTAMPTZ DEFAULT NOW()
);
