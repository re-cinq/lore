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

  -- Facts: extracted from memories and episodes
  CREATE TABLE IF NOT EXISTS memory.facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id       UUID REFERENCES memory.memories(id),
    episode_id      UUID,
    fact_text       TEXT NOT NULL,
    embedding       VECTOR(768),
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,
    invalidated_by  UUID REFERENCES memory.facts(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT facts_source_check CHECK (memory_id IS NOT NULL OR episode_id IS NOT NULL)
  );

  -- Migrate existing facts table: add new columns if missing
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT now();
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS invalidated_by UUID;
  ALTER TABLE memory.facts ADD COLUMN IF NOT EXISTS episode_id UUID;
  ALTER TABLE memory.facts ALTER COLUMN memory_id DROP NOT NULL;

  -- Backfill valid_from from created_at for existing facts
  UPDATE memory.facts SET valid_from = created_at WHERE valid_from = created_at;

  CREATE INDEX IF NOT EXISTS facts_embedding_idx
    ON memory.facts USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX IF NOT EXISTS facts_active_embedding_idx
    ON memory.facts USING hnsw (embedding vector_cosine_ops)
    WHERE valid_to IS NULL;
  CREATE INDEX IF NOT EXISTS facts_valid_idx
    ON memory.facts (valid_to) WHERE valid_to IS NULL;

  -- Episodes: raw ingestion blobs
  CREATE TABLE IF NOT EXISTS memory.episodes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     TEXT NOT NULL,
    content      TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'manual',
    ref          TEXT,
    embedding    VECTOR(768),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS episodes_agent_hash_idx
    ON memory.episodes (agent_id, content_hash);
  CREATE INDEX IF NOT EXISTS episodes_agent_source_idx
    ON memory.episodes (agent_id, source, created_at DESC);
  CREATE INDEX IF NOT EXISTS episodes_embedding_idx
    ON memory.episodes USING hnsw (embedding vector_cosine_ops);

  -- FK from facts to episodes
  DO \$\$ BEGIN
    ALTER TABLE memory.facts
      ADD CONSTRAINT facts_episode_fk
      FOREIGN KEY (episode_id) REFERENCES memory.episodes(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;

  -- Knowledge graph: entities
  CREATE TABLE IF NOT EXISTS memory.entities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    properties   JSONB DEFAULT '{}',
    repo         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS entities_name_type_repo_idx
    ON memory.entities (name, entity_type, COALESCE(repo, ''));

  -- Knowledge graph: edges (relationships between entities)
  CREATE TABLE IF NOT EXISTS memory.edges (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id         UUID NOT NULL REFERENCES memory.entities(id),
    target_id         UUID NOT NULL REFERENCES memory.entities(id),
    relation_type     TEXT NOT NULL,
    properties        JSONB DEFAULT '{}',
    valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to          TIMESTAMPTZ,
    source_episode_id UUID REFERENCES memory.episodes(id),
    source_memory_id  UUID REFERENCES memory.memories(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS edges_source_idx
    ON memory.edges (source_id) WHERE valid_to IS NULL;
  CREATE INDEX IF NOT EXISTS edges_target_idx
    ON memory.edges (target_id) WHERE valid_to IS NULL;
  CREATE INDEX IF NOT EXISTS edges_relation_idx
    ON memory.edges (source_id, relation_type) WHERE valid_to IS NULL;

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

  DO \$\$ BEGIN
    ALTER TABLE memory.memories
      ADD CONSTRAINT memories_pool_fk
      FOREIGN KEY (pool_id) REFERENCES memory.shared_pools(id)
      NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;

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

  -- Add FK and CHECK constraints (idempotent via DO blocks)
  DO \$\$ BEGIN
    ALTER TABLE memory.facts ADD CONSTRAINT facts_invalidated_by_fk
      FOREIGN KEY (invalidated_by) REFERENCES memory.facts(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;

  DO \$\$ BEGIN
    ALTER TABLE memory.facts ADD CONSTRAINT facts_source_check
      CHECK (memory_id IS NOT NULL OR episode_id IS NOT NULL);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;

  -- Grant access to lore user
  GRANT USAGE ON SCHEMA memory TO lore;
  GRANT ALL ON ALL TABLES IN SCHEMA memory TO lore;
  ALTER DEFAULT PRIVILEGES IN SCHEMA memory GRANT ALL ON TABLES TO lore;
"

echo "[lore] Memory schema created."
