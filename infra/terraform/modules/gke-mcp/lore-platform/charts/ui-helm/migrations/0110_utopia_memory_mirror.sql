-- 0110_utopia_memory_mirror: memories and episodes mirrored into Utopia (specs/utopia-graph-mirror FR16, ADR-052 amendment 2026-10-19).
--
-- Every memories and episodes row gets a mirror sequence number. An insert takes the next
-- one, and so does an update that changes a memory's value or its deleted flag. lore-api's
-- walk pushes the rows above its cursor, so a delete, an expiry or an eviction made by the
-- stations' sweeps reaches Utopia as a tombstone, though only lore-api can push. It is a
-- trigger and not a write each writer makes: memory.memories has writers in two processes.
--
-- lore.utopia_memory_sources holds the two `api` sources of each base, `memories` and
-- `episodes`, with their push keys and the walk's cursors. A base is a repo's knowledge base,
-- or `<org>/memory` for rows no onboarded repo owns. That base has no lore.repos row to keep
-- settings on, so the cursors live here. Only lore (lore-api) may read the table: like
-- lore.utopia_sources (0109), it holds credentials.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and the numbering
-- touches only rows that have no number yet. Runs as `lore`, the owner.

CREATE SEQUENCE IF NOT EXISTS memory.mirror_seq;

ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS mirror_seq BIGINT;
ALTER TABLE memory.episodes ADD COLUMN IF NOT EXISTS mirror_seq BIGINT;

-- Existing rows are numbered in the order they were written, so the first walk reads oldest first.
UPDATE memory.memories m SET mirror_seq = numbered.seq
  FROM (SELECT id, nextval('memory.mirror_seq') AS seq
          FROM (SELECT id FROM memory.memories WHERE mirror_seq IS NULL ORDER BY created_at, id) ordered) numbered
 WHERE m.id = numbered.id;
UPDATE memory.episodes e SET mirror_seq = numbered.seq
  FROM (SELECT id, nextval('memory.mirror_seq') AS seq
          FROM (SELECT id FROM memory.episodes WHERE mirror_seq IS NULL ORDER BY created_at, id) ordered) numbered
 WHERE e.id = numbered.id;

ALTER TABLE memory.memories ALTER COLUMN mirror_seq SET DEFAULT nextval('memory.mirror_seq');
ALTER TABLE memory.memories ALTER COLUMN mirror_seq SET NOT NULL;
ALTER TABLE memory.episodes ALTER COLUMN mirror_seq SET DEFAULT nextval('memory.mirror_seq');
ALTER TABLE memory.episodes ALTER COLUMN mirror_seq SET NOT NULL;

CREATE INDEX IF NOT EXISTS memories_mirror_seq_idx ON memory.memories (mirror_seq);
CREATE INDEX IF NOT EXISTS episodes_mirror_seq_idx ON memory.episodes (mirror_seq);

CREATE OR REPLACE FUNCTION memory.next_mirror_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.mirror_seq := nextval('memory.mirror_seq');
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS memories_mirror_seq ON memory.memories;
CREATE TRIGGER memories_mirror_seq
  BEFORE UPDATE ON memory.memories
  FOR EACH ROW
  WHEN (OLD.value IS DISTINCT FROM NEW.value OR OLD.is_deleted IS DISTINCT FROM NEW.is_deleted)
  EXECUTE FUNCTION memory.next_mirror_seq();

CREATE TABLE IF NOT EXISTS lore.utopia_memory_sources (
  base        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('memories', 'episodes')),
  kb_id       TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  source_key  TEXT NOT NULL,
  -- The mirror sequence number of the last row the walk pushed; NULL until one lands.
  cursor      BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS utopia_memory_sources_base_kind_idx
  ON lore.utopia_memory_sources (lower(base), kind);

GRANT ALL ON lore.utopia_memory_sources TO lore;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'REVOKE ALL ON lore.utopia_memory_sources FROM lore_ui';
  END IF;
END$$;
