import type { Pool, QueryResultRow } from "pg";

const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

// A table or column that may not exist yet (migration-gated) degrades to empty rows rather than 500.
export async function optionalTableRows<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const { rows } = await pool.query<T>(sql, params);

    return rows;
  } catch (err) {
    const code = (err as { code?: string }).code;

    if (code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN) {
      return [];
    }

    throw err;
  }
}

/** One interval, in both the shapes the reads below need: the day pair the billing tables are keyed by, and the timestamp bounds the per-call tables are. */
export interface SpendWindow {
  interval: { from: string; to: string };
  fromTs: string;
  toTs: string;
}
