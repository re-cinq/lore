-- 0123_utopia_pushed_items: the statement items last pushed for each mirrored document (ADR-052).
--
-- A spec or ADR is mirrored into its repo's `test-coverage` source as one item per statement,
-- `stmt:<path>#<ordinal>`. A statement that is gone from the document is never pushed again, so its
-- item, and the facts it carries, stayed in Utopia. Lore keeps the ids it pushed here, one row per
-- document, and tombstones the ones a later version or the document's deletion no longer has.
--
-- Idempotent: IF NOT EXISTS. Runs as `lore`, the owner of the lore schema.

CREATE TABLE IF NOT EXISTS lore.utopia_pushed_items (
  repo          TEXT NOT NULL,
  path          TEXT NOT NULL,
  external_ids  TEXT[] NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS utopia_pushed_items_doc_idx
  ON lore.utopia_pushed_items (lower(repo), path);

GRANT ALL ON lore.utopia_pushed_items TO lore;
