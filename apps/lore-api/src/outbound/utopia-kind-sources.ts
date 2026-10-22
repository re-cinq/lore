// The Utopia source of each mirrored kind of each repo (lore.utopia_kind_sources, migration 0114, specs/utopia-graph-mirror FR18). Like lore.utopia_sources, the keys are credentials no route answers.

import type { Pool } from "pg";
import type { UtopiaSource } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { StoredUtopiaSource } from "./utopia-sources.js";

export type MirrorKind = "docs" | "test-coverage" | "git-history" | "github";

export interface KindSourceKey {
  repo: string;
  kind: MirrorKind;
  kbId: string;
}

/** One row per repo and kind, matched without regard to case, so a source saved again replaces the key the row held. */
export async function saveKindSource(
  pool: Pool,
  { repo, kind, kbId }: KindSourceKey,
  source: UtopiaSource,
): Promise<void> {
  await pool.query(
    `INSERT INTO lore.utopia_kind_sources (repo, kind, kb_id, source_id, source_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ((lower(repo)), kind) DO UPDATE
       SET kb_id = EXCLUDED.kb_id, source_id = EXCLUDED.source_id,
           source_key = EXCLUDED.source_key, updated_at = now()`,
    [repo, kind, kbId, source.id, source.key],
  );
}

export async function kindSourceFor(
  pool: Pool,
  repo: string,
  kind: MirrorKind,
): Promise<StoredUtopiaSource | null> {
  const { rows } = await pool.query<StoredUtopiaSource>(
    `SELECT source_id AS id, source_key AS key, kb_id AS "kbId"
       FROM lore.utopia_kind_sources WHERE lower(repo) = lower($1) AND kind = $2`,
    [repo, kind],
  );

  return rows.at(0) ?? null;
}
