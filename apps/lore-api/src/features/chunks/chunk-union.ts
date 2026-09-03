import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface ChunkUnionOrder {
  orderBy: string;
  limit: number;
}

export type ChunkSelectFn = (
  schema: string,
  paramOffset: number,
) => { sql: string; params: unknown[] };

const enforcePositiveInteger = (limit: number): void => {
  enforceTrue(
    !(!Number.isInteger(limit) || limit <= 0),
    Error,
    `chunk-union limit must be a positive integer: ${limit}`,
  );
};

const SAFE_ORDER_TERM_RE = /^[a-z_][a-z0-9_]*(\s+(ASC|DESC))?$/i;

const enforceOrderByTerms = (orderBy: string): void => {
  const safe = orderBy
    .split(",")
    .map((term) => term.trim())
    .every((term) => SAFE_ORDER_TERM_RE.test(term));

  enforceTrue(
    safe,
    Error,
    `chunk-union orderBy contains an unsafe term: ${orderBy}`,
  );
};

// UNION ALL across schemas with per-branch pruning; orderBy/limit validated, null when no schemas.
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
