#!/usr/bin/env bash
set -euo pipefail

# Create the memory schema and tables in the existing lore database.
# Run after setup-db.sh has created the lore database.

NS="alloydb"
POD="lore-db-1"

echo "[lore] Creating memory schema and tables..."

kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
  CREATE SCHEMA IF NOT EXISTS memory;

  -- Memories: the core table
  CREATE TABLE IF NOT EXISTS memory.memories (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     TEXT NOT NULL,
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    embedding    VECTOR(768),
    version      INTEGER NOT NULL DEFAULT 1,
    is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    pool_id      UUID,
    ttl_seconds  INTEGER,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata     JSONB
  );

  CREATE UNIQUE INDEX IF NOT EXISTS memories_agent_key_version_idx
    ON memory.memories (agent_id, key, version);
  CREATE INDEX IF NOT EXISTS memories_agent_id_idx
    ON memory.memories (agent_id);
  CREATE INDEX IF NOT EXISTS memories_active_idx
    ON memory.memories (agent_id, key)
    WHERE is_deleted = FALSE;
  CREATE INDEX IF NOT EXISTS memories_embedding_idx
    ON memory.memories USING hnsw (embedding vector_cosine_ops);

  -- Memory versions: full history
  CREATE TABLE IF NOT EXISTS memory.memory_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id    UUID NOT NULL REFERENCES memory.memories(id),
    version      INTEGER NOT NULL,
    value        TEXT NOT NULL,
    embedding    VECTOR(768),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS memory_versions_mid_version_idx
    ON memory.memory_versions (memory_id, version);

  -- Facts: extracted from memories
  CREATE TABLE IF NOT EXISTS memory.facts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id    UUID NOT NULL REFERENCES memory.memories(id),
    fact_text    TEXT NOT NULL,
    embedding    VECTOR(768),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS facts_embedding_idx
    ON memory.facts USING hnsw (embedding vector_cosine_ops);

  -- Snapshots: reference-based
  CREATE TABLE IF NOT EXISTS memory.snapshots (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     TEXT NOT NULL,
    memory_refs  JSONB NOT NULL,
    trigger      TEXT NOT NULL DEFAULT 'manual',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS snapshots_agent_idx
    ON memory.snapshots (agent_id, created_at DESC);

  -- Shared pools
  CREATE TABLE IF NOT EXISTS memory.shared_pools (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT UNIQUE NOT NULL,
    created_by   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE memory.memories
    ADD CONSTRAINT memories_pool_fk
    FOREIGN KEY (pool_id) REFERENCES memory.shared_pools(id)
    NOT VALID;

  -- Audit log: append-only
  CREATE TABLE IF NOT EXISTS memory.audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     TEXT NOT NULL,
    operation    TEXT NOT NULL,
    memory_key   TEXT,
    pool_name    TEXT,
    metadata     JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS audit_agent_time_idx
    ON memory.audit_log (agent_id, created_at DESC);

  -- Grant access to lore user
  GRANT USAGE ON SCHEMA memory TO lore;
  GRANT ALL ON ALL TABLES IN SCHEMA memory TO lore;
  ALTER DEFAULT PRIVILEGES IN SCHEMA memory GRANT ALL ON TABLES TO lore;
"

echo "[lore] Memory schema created."
