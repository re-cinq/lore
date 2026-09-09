import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface ChunkUnionOrder {
  orderBy: string;
  limit: number;
}

export type ChunkSelectFn = (
  schema: string,
  paramOffset: number,
) => { sql: string; params: unknown[] };

// UNION ALL across schemas with per-branch pruning; orderBy/limit validated, null when no schemas.
export function buildChunkUnionQuery(
  schemas: string[],
  selectFn: ChunkSelectFn,
  baseParams: unknown[] = [],
  order?: ChunkUnionOrder,
): { sql: string; params: unknown[] } | null {
  if (order) {
    enforceSafeOrder(order);
  }

  const { parts, allParams } = buildBranches(
    schemas,
    selectFn,
    baseParams,
    order,
  );

  if (parts.length === 0) {
    return null;
  }

  return { sql: composeUnion(parts, order), params: allParams };
}

// orderBy and limit are interpolated, not bound, so both are validated before they reach the SQL.
function enforceSafeOrder(order: ChunkUnionOrder): void {
  enforcePositiveInteger(order.limit);
  enforceOrderByTerms(order.orderBy);
}

function buildBranches(
  schemas: string[],
  selectFn: ChunkSelectFn,
  baseParams: unknown[],
  order: ChunkUnionOrder | undefined,
): { parts: string[]; allParams: unknown[] } {
  const parts: string[] = [];
  const allParams: unknown[] = [...baseParams];

  for (const schema of schemas) {
    const { sql, params } = selectFn(schema, allParams.length + 1);

    parts.push(wrapBranch(sql, order));
    allParams.push(...params);
  }

  return { parts, allParams };
}

// The outer ORDER BY/LIMIT repeats each branch's own clause: branches prune first, then the merged set is re-ordered.
function composeUnion(
  parts: string[],
  order: ChunkUnionOrder | undefined,
): string {
  const unionSql = parts.join(" UNION ALL ");

  return order ? `${unionSql}${orderClause(order)}` : unionSql;
}

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

function wrapBranch(sql: string, order: ChunkUnionOrder | undefined): string {
  if (!order) {
    return sql;
  }

  return `(${sql}${orderClause(order)})`;
}

function orderClause(order: ChunkUnionOrder): string {
  return ` ORDER BY ${order.orderBy} LIMIT ${order.limit}`;
}
