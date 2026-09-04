import type { PgPool } from "../../memory-store.js";

// Live knowledge-graph read over memory.entities + memory.edges, relocated from mcp-server/graph.ts; returns rows in the same snake_case shape lore_query_graph + context-assembly already consume.
export interface LiveGraphResult {
  entity: string;
  entity_type: string;
  relation: string;
  related_entity: string;
  related_type: string;
  direction: "outgoing" | "incoming";
  valid_from: string;
}

export interface LiveGraphFilter {
  entity?: string;
  relationType?: string;
  repo?: string;
  includeInvalidated?: boolean;
}

/** `value || null`, spelled as a call so it's not one more branch in the caller. */
function emptyToNull(value: string | undefined): string | null {
  return value || null;
}

function entityGraphQuery(validFilter: string): string {
  return `SELECT
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
       AND ($3::text IS NULL OR s.repo = $3)
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
       AND ($3::text IS NULL OR t.repo = $3)
     ORDER BY valid_from DESC
     LIMIT 50`;
}

function allGraphQuery(validFilter: string): string {
  return `SELECT
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
     AND ($2::text IS NULL OR s.repo = $2)
   ORDER BY e.created_at DESC
   LIMIT 50`;
}

export async function queryLiveGraph(
  pool: PgPool,
  {
    entity,
    relationType,
    repo,
    includeInvalidated = false,
  }: LiveGraphFilter = {},
): Promise<LiveGraphResult[]> {
  const validFilter = includeInvalidated ? "" : "AND e.valid_to IS NULL";
  const relationParam = emptyToNull(relationType);
  const repoParam = emptyToNull(repo);

  if (entity) {
    const { rows } = await pool.query<LiveGraphResult>(
      entityGraphQuery(validFilter),
      [entity, relationParam, repoParam],
    );

    return rows;
  }

  const { rows } = await pool.query<LiveGraphResult>(
    allGraphQuery(validFilter),
    [relationParam, repoParam],
  );

  return rows;
}
