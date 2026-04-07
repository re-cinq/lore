# DB Schema Contract: Hippo-Memory Adaptations

## memory.memories — new columns

```sql
-- Retrieval strengthening (FR-1)
ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retrieval_count INTEGER NOT NULL DEFAULT 0;

-- Index for decay job ordering
CREATE INDEX IF NOT EXISTS memories_retrieval_count_idx
  ON memory.memories (retrieval_count, last_retrieved_at);
```

## memory.facts — new columns

```sql
-- Epistemic confidence tiers (FR-2)
ALTER TABLE memory.facts
  ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'inferred'
    CHECK (confidence IN ('verified', 'observed', 'inferred', 'stale')),
  ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retrieval_count INTEGER NOT NULL DEFAULT 0;

-- Index for stale decay job
CREATE INDEX IF NOT EXISTS facts_confidence_age_idx
  ON memory.facts (confidence, last_retrieved_at, created_at)
  WHERE valid_to IS NULL;
```

## memory.audit_log — metadata extension (no schema change)

The existing `metadata JSONB` column on `memory.audit_log` is extended
to include `memory_keys` on `assemble_context` operations:

```jsonc
// audit_log.metadata for operation = 'assemble_context'
{
  "query": "deployment process",
  "task_id": "task-abc123",          // when called from a pipeline task
  "memory_keys": ["key-a", "key-b"], // keys of memories included in output
  "fact_count": 12,
  "latency_ms": 145
}
```

No DDL change required — `metadata` is already `JSONB`.

## Backfill

```sql
-- Existing facts get confidence = 'inferred' by default column value.
-- No explicit backfill needed.

-- Existing memories get retrieval_count = 0 by default column value.
-- No explicit backfill needed.
```
