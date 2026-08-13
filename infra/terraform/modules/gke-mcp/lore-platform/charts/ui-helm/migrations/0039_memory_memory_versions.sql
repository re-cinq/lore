-- 0039_memory_memory_versions: create the memory.memory_versions table (#1154).
--
-- The table has been declared by scripts/infra/setup-memory-schema.sh since the
-- memory feature landed, but prod never got it — the schema there predates /
-- diverged from the script (the tables were hand-applied during development).
-- With the table missing:
--   * every /agents/[id] web-ui page with >= 1 memory 500'd (42P01, digest
--     4187600444) — the page is the only web-ui reader of memory_versions, and
--   * every memory write half-failed: writeMemory inserted the memories row,
--     then threw on the version INSERT, so no version history and no `write`
--     audit_log rows were ever recorded (the write ordering is now transactional,
--     see libs/server-core/src/features/memory/memory.ts).
--
-- Ownership caveat (same as 0012/0013): on clusters where the `memory` schema
-- was bootstrapped by the superuser, the `lore` migration runner holds only
-- USAGE — not the CREATE that CREATE TABLE requires. This runs inside a
-- subtransaction that catches insufficient_privilege and skips with a NOTICE
-- rather than failing the deploy; those clusters converge by re-running the
-- idempotent setup-memory-schema.sh as the superuser. Where lore may create in
-- the schema, this converges automatically.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
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

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore') THEN
    EXECUTE 'GRANT ALL ON memory.memory_versions TO lore';
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON memory.memory_versions TO lore_ui';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skip memory.memory_versions (runner cannot create in schema memory); run setup-memory-schema.sh as the superuser to converge';
END$$;
