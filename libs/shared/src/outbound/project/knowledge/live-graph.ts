import type { PgPool } from "../../memory-store.js";

// A computed self-join projection over memory.entities + memory.edges (entity/related_entity/direction are query-time aliases) — not one table's row; returns the snake_case shape lore_query_graph + context-assembly already consume.

export interface LiveGraphResult {
  entity: string;
  entity_type: string;
  relation: string;
  related_entity: string;
  related_type: string;
  direction: "outgoing" | "incoming";
  properties: Record<string, unknown>;
  valid_from: string;
}

export interface LiveGraphFilter {
  entity?: string;
  relationType?: string;
  repo?: string;
  includeInvalidated?: boolean;
}

export async function queryLiveGraph(
  pool: PgPool,
  filter: LiveGraphFilter = {},
): Promise<LiveGraphResult[]> {
  const { entity, relationType, repo, includeInvalidated = false } = filter;
  const validFilter = includeInvalidated ? "" : "AND e.valid_to IS NULL";
  const params = [emptyToNull(relationType), emptyToNull(repo)];

  return entity
    ? runGraphQuery(pool, entityGraphQuery(validFilter), [entity, ...params])
    : runGraphQuery(pool, allGraphQuery(validFilter), params);
}

/** `value || null`, spelled as a call so it's not one more branch in the caller. */
function emptyToNull(value: string | undefined): string | null {
  return value || null;
}

function entityGraphQuery(validFilter: string): string {
  return `${edgesMatching("s", "outgoing", validFilter)}
     UNION ALL
     ${edgesMatching("t", "incoming", validFilter)}
     ORDER BY valid_from DESC
     LIMIT 50`;
}

/** The entity's edges where it is the `matched` end. Every row reads source→target whichever end matched, so `entity` is always the edge's source. */
function edgesMatching(
  matched: "s" | "t",
  direction: "outgoing" | "incoming",
  validFilter: string,
): string {
  return `SELECT
       s.name as entity, s.entity_type,
       e.relation_type as relation,
       t.name as related_entity, t.entity_type as related_type,
       '${direction}' as direction,
       e.properties,
       e.valid_from
     FROM memory.edges e
     JOIN memory.entities s ON s.id = e.source_id
     JOIN memory.entities t ON t.id = e.target_id
     WHERE LOWER(${matched}.name) = LOWER($1)
       ${validFilter}
       AND ($2::text IS NULL OR e.relation_type = $2)
       AND ($3::text IS NULL OR s.repo = $3)`;
}

function allGraphQuery(validFilter: string): string {
  return `SELECT
     s.name as entity, s.entity_type,
     e.relation_type as relation,
     t.name as related_entity, t.entity_type as related_type,
     'outgoing' as direction,
     e.properties,
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

async function runGraphQuery(
  pool: PgPool,
  sql: string,
  params: Array<string | null>,
): Promise<LiveGraphResult[]> {
  const { rows } = await pool.query<LiveGraphResult>(sql, params);

  return rows;
}
