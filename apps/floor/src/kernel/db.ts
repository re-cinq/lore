// The Floor's Postgres pool: the pool itself is shared (`@re-cinq/lore-shared/db/pg-pool.js`); what stays here is `query`, the Floor's last inline-SQL escape hatch (kept for reads not yet behind a port), deliberately NOT shared so other services can't reach through it too.

export {
  getPool,
  initPool,
  isDbAvailable,
  resetPool,
} from "@re-cinq/lore-shared/db/pg-pool.js";

import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await getPool().query(text, params);

  return rows as T[];
}
