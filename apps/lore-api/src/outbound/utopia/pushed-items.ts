// The statement items last pushed for each mirrored document (lore.utopia_pushed_items, migration 0123), so the ones a later version no longer has are tombstoned.

import type { Pool } from "pg";

export async function pushedItemsFor(
  pool: Pool,
  repo: string,
  path: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ external_ids: string[] }>(
    "SELECT external_ids FROM lore.utopia_pushed_items WHERE lower(repo) = lower($1) AND path = $2",
    [repo, path],
  );

  return rows.at(0)?.external_ids ?? [];
}

/** One row per document, matched on the repo without regard to case, so the latest push replaces the list. */
export async function savePushedItems(
  pool: Pool,
  repo: string,
  path: string,
  externalIds: string[],
): Promise<void> {
  await pool.query(
    `INSERT INTO lore.utopia_pushed_items (repo, path, external_ids) VALUES ($1, $2, $3)
     ON CONFLICT ((lower(repo)), path) DO UPDATE
       SET external_ids = EXCLUDED.external_ids, updated_at = now()`,
    [repo, path, externalIds],
  );
}
