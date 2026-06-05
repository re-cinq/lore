-- 0013_memory_hippo_columns: backfill the hippo-memory schema (ADR-016) onto
-- memory.facts / memory.memories, plus memory.fact_conflicts.
--
-- ADR-016 (hippo-memory-adaptations) added confidence tiers, retrieval
-- strengthening (retrieval_count / last_retrieved_at / half_life_days), and the
-- fact_conflicts table to the baseline setup-memory-schema.sh. The code shipped
-- expecting them — mcp-server/src/memory-search.ts selects `f.confidence` in
-- vectorSearchFacts — but DBs bootstrapped before that landed never got the
-- columns. On prod that left `memory.facts.confidence` missing, so every
-- searchMemories() call threw `column f.confidence does not exist`, which both
-- the `memories` and `episodes` context-assembly sources swallowed: memory and
-- episodes were silently absent from ALL assembled context, org-wide. The
-- prompt-debug view's per-source `source error` status is what surfaced it.
--
-- Ownership caveat (same as 0012): the `memory` schema is created by the
-- bootstrap superuser (setup-memory-schema.sh, `psql -U postgres`), so postgres
-- owns memory.facts/memories and the `lore` migration runner only holds GRANT —
-- not the ownership ADD COLUMN / ADD CONSTRAINT / CREATE TABLE require. This runs
-- inside a subtransaction that catches insufficient_privilege and skips with a
-- NOTICE rather than failing the deploy. Where lore owns the tables it converges
-- automatically; on superuser-owned clusters (prod) converge by re-running the
-- idempotent setup-memory-schema.sh as the superuser, which declares all of this.
--
-- Idempotent: safe to re-run.

DO $migrate$
BEGIN
  -- Retrieval strengthening (hippo-memory inspired)
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 30;

  ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS retrieval_count INT DEFAULT 0;
  ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ;
  ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS half_life_days INT DEFAULT 60;

  -- Confidence tiers on facts (the column whose absence broke retrieval)
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'observed';

  BEGIN
    ALTER TABLE memory.facts ADD CONSTRAINT facts_confidence_check
      CHECK (confidence IN ('verified', 'observed', 'inferred', 'stale'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Conflict surfacing
  CREATE TABLE IF NOT EXISTS memory.fact_conflicts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    old_fact_id UUID NOT NULL REFERENCES memory.facts(id),
    new_fact_id UUID NOT NULL REFERENCES memory.facts(id),
    similarity  FLOAT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS fact_conflicts_old_idx
    ON memory.fact_conflicts (old_fact_id);
  CREATE INDEX IF NOT EXISTS fact_conflicts_new_idx
    ON memory.fact_conflicts (new_fact_id);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skip memory.* hippo columns (runner is not the table owner); run setup-memory-schema.sh as the superuser to converge';
END$migrate$;
