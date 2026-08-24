// The Floor's Postgres pool.
//
// The pool itself is the shared one (`@re-cinq/lore-shared/db/pg-pool.js`) —
// three services had produced a byte-identical copy of it, which is one copy
// past the point where duplication is cheaper than a seam.
//
// What stays here is the pair below. `query`/`queryOne` are the Floor's last
// inline-SQL escape hatch, kept because a handful of knowledge reads have not
// moved behind a port yet (see "Floor data access" above). They are deliberately
// NOT shared: giving every service this hatch would invite the next one to
// reach through it, and the ports exist so it does not have to.

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

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);

  return rows[0] || null;
}
