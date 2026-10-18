// The `memories` and `episodes` api sources of each Utopia base (lore.utopia_memory_sources, migration 0110), with their keys and the memory walk's cursors (specs/utopia-graph-mirror FR16). Like lore.utopia_sources, the keys are credentials no route answers.

import type { Pool } from "pg";
import type { StoredUtopiaSource } from "./utopia-sources.js";

export type MemoryKind = "memories" | "episodes";

/** A repo's knowledge base, or the org's `<org>/memory` one for the rows no onboarded repo owns. */
export interface MemoryBase {
  name: string;
  repo: boolean;
}

export interface SavedMemorySource {
  base: string;
  kind: MemoryKind;
  kbId: string;
  sourceId: string;
  key: string;
}

/** A source saved again starts its walk over: a new source holds none of the documents the old one did. */
export async function saveMemorySource(
  pool: Pool,
  source: SavedMemorySource,
): Promise<void> {
  await pool.query(
    `INSERT INTO lore.utopia_memory_sources (base, kind, kb_id, source_id, source_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ((lower(base)), kind) DO UPDATE
       SET kb_id = EXCLUDED.kb_id, source_id = EXCLUDED.source_id,
           source_key = EXCLUDED.source_key, cursor = NULL, updated_at = now()`,
    [source.base, source.kind, source.kbId, source.sourceId, source.key],
  );
}

export interface StoredMemorySource extends StoredUtopiaSource {
  /** The mirror sequence number of the last row the walk pushed. */
  cursor: string | null;
}

export async function memorySourceFor(
  pool: Pool,
  base: string,
  kind: MemoryKind,
): Promise<StoredMemorySource | null> {
  const { rows } = await pool.query<StoredMemorySource>(
    `SELECT source_id AS id, source_key AS key, kb_id AS "kbId", cursor::text AS cursor
       FROM lore.utopia_memory_sources WHERE lower(base) = lower($1) AND kind = $2`,
    [base, kind],
  );

  return rows.at(0) ?? null;
}

export async function saveMemoryCursor(
  pool: Pool,
  base: string,
  kind: MemoryKind,
  seq: string,
): Promise<void> {
  await pool.query(
    `UPDATE lore.utopia_memory_sources SET cursor = $3::bigint, updated_at = now()
      WHERE lower(base) = lower($1) AND kind = $2`,
    [base, kind, seq],
  );
}
