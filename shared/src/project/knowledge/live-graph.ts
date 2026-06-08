import type { PgPool } from "../../memory-store.js";

/**
 * Live knowledge-graph read over memory.entities + memory.edges. Relocated from
 * mcp-server/src/graph.ts so the query lives once; mcp re-exports it and the
 * KnowledgePort adapter calls it. Returns rows in the same snake_case shape the
 * query_graph tool + context-assembly already consume — byte-for-byte the same.
 */
export interface LiveGraphResult {
  entity: string;
  entity_type: string;
  relation: string;
  related_entity: string;
  related_type: string;
  direction: "outgoing" | "incoming";
  valid_from: string;
}

export async function queryLiveGraph(
  pool: PgPool,
  entity?: string,
  relationType?: string,
  repo?: string,
  includeInvalidated = false,
): Promise<LiveGraphResult[]> {
  const validFilter = includeInvalidated ? "" : "AND e.valid_to IS NULL";

  if (entity) {
    const { rows } = await pool.query(
      `SELECT
         s.name as entity, s.entity_type,
         e.relation_type as relation,
         t.name as related_entity, t.entity_type as related_type,
         'outgoing' as direction,
         e.valid_from
       FROM memory.edges e
       JOIN memory.entities s ON s.id = e.source_id
       JOIN memory.entities t ON t.id = e.target_id
       WHERE LOWER(s.name) = LOWER($1)
         ${validFilter}
         AND ($2::text IS NULL OR e.relation_type = $2)
         AND ($3::text IS NULL OR s.repo = $3 OR s.repo IS NULL)
       UNION ALL
       SELECT
         t.name as entity, t.entity_type,
         e.relation_type as relation,
         s.name as related_entity, s.entity_type as related_type,
         'incoming' as direction,
         e.valid_from
       FROM memory.edges e
       JOIN memory.entities s ON s.id = e.source_id
       JOIN memory.entities t ON t.id = e.target_id
       WHERE LOWER(t.name) = LOWER($1)
         ${validFilter}
         AND ($2::text IS NULL OR e.relation_type = $2)
         AND ($3::text IS NULL OR t.repo = $3 OR t.repo IS NULL)
       ORDER BY valid_from DESC
       LIMIT 50`,
      [entity, relationType || null, repo || null],
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT
       s.name as entity, s.entity_type,
       e.relation_type as relation,
       t.name as related_entity, t.entity_type as related_type,
       'outgoing' as direction,
       e.valid_from
     FROM memory.edges e
     JOIN memory.entities s ON s.id = e.source_id
     JOIN memory.entities t ON t.id = e.target_id
     WHERE 1=1
       ${validFilter}
       AND ($1::text IS NULL OR e.relation_type = $1)
       AND ($2::text IS NULL OR s.repo = $2 OR s.repo IS NULL)
     ORDER BY e.created_at DESC
     LIMIT 50`,
    [relationType || null, repo || null],
  );
  return rows;
}
