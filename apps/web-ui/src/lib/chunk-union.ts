export interface ChunkUnionOrder {
  orderBy: string;
  limit: number;
}

export type ChunkSelectFn = (
  schema: string,
  paramOffset: number,
) => { sql: string; params: unknown[] };

const enforcePositiveInteger = (limit: number): void => {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`chunk-union limit must be a positive integer: ${limit}`);
  }
};

const SAFE_ORDER_TERM_RE = /^[a-z_][a-z0-9_]*(\s+(ASC|DESC))?$/i;

const enforceOrderByTerms = (orderBy: string): void => {
  const safe = orderBy
    .split(",")
    .map((term) => term.trim())
    .every((term) => SAFE_ORDER_TERM_RE.test(term));

  if (!safe) {
    throw new Error(`chunk-union orderBy contains an unsafe term: ${orderBy}`);
  }
};

/**
 * Build a UNION ALL query across chunk schemas. With `order`, each branch is
 * wrapped as `(SELECT ... ORDER BY ... LIMIT n)` so Postgres prunes per schema
 * (top-N per branch), and the union gets an outer ORDER BY + LIMIT for the
 * global top-N — equivalent to sorting the full union, without fetching it.
 *
 * `order.orderBy` and each branch's sql are interpolated: callers pass trusted
 * literals only (same trust model as the schema interpolation in `selectFn`).
 * `order.limit` is enforced as a positive integer and `order.orderBy` as
 * comma-separated `column [ASC|DESC]` terms before any SQL is built. Returns
 * null when there are no schemas to query.
 */
export function buildChunkUnionQuery(
  schemas: string[],
  selectFn: ChunkSelectFn,
  baseParams: unknown[] = [],
  order?: ChunkUnionOrder,
): { sql: string; params: unknown[] } | null {
  if (order) {
    enforcePositiveInteger(order.limit);
    enforceOrderByTerms(order.orderBy);
  }
  const parts: string[] = [];
  const allParams: unknown[] = [...baseParams];

  for (const schema of schemas) {
    const { sql, params } = selectFn(schema, allParams.length + 1);

    parts.push(
      order ? `(${sql} ORDER BY ${order.orderBy} LIMIT ${order.limit})` : sql,
    );
    allParams.push(...params);
  }

  if (parts.length === 0) {
    return null;
  }
  const unionSql = parts.join(" UNION ALL ");
  const sql = order
    ? `${unionSql} ORDER BY ${order.orderBy} LIMIT ${order.limit}`
    : unionSql;

  return { sql, params: allParams };
}
