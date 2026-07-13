export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import GraphView, {
  type Entity,
  type Edge,
  type Stats,
  type EntityTypeCount,
} from "./GraphView";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    type?: string;
    show_invalid?: string;
  }>;
}) {
  const { entity, type, show_invalid } = await searchParams;
  const showInvalid = show_invalid === "1";

  const [stats] = await query<Stats>(`
    SELECT
      (SELECT count(*)::int FROM memory.entities) as entity_count,
      (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NULL) as active_edge_count,
      (SELECT count(*)::int FROM memory.edges WHERE valid_to IS NOT NULL) as invalidated_edge_count
  `);

  const entityTypes = await query<EntityTypeCount>(`
    SELECT entity_type, count(*)::int as cnt
    FROM memory.entities
    GROUP BY entity_type
    ORDER BY cnt DESC
  `);

  // If an entity is selected, show its edges
  let edges: Edge[] = [];
  if (entity) {
    const validFilter = showInvalid ? "" : "AND e.valid_to IS NULL";
    edges = await query<Edge>(
      `
      SELECT s.name as source_name, s.entity_type as source_type,
             e.relation_type, t.name as target_name, t.entity_type as target_type,
             e.valid_from, e.valid_to,
             CASE WHEN ep.id IS NOT NULL THEN 'episode' ELSE 'memory' END as source_label
      FROM memory.edges e
      JOIN memory.entities s ON s.id = e.source_id
      JOIN memory.entities t ON t.id = e.target_id
      LEFT JOIN memory.episodes ep ON ep.id = e.source_episode_id
      WHERE (LOWER(s.name) = LOWER($1) OR LOWER(t.name) = LOWER($1))
        ${validFilter}
      ORDER BY e.valid_from DESC
      LIMIT 50
    `,
      [entity],
    );
  }

  // List entities (filtered by type if specified)
  const entityConditions: string[] = [];
  const entityParams: string[] = [];
  const pi = 1;
  if (type) {
    entityConditions.push(`en.entity_type = $${pi}`);
    entityParams.push(type);
  }
  const entityWhere =
    entityConditions.length > 0
      ? `WHERE ${entityConditions.join(" AND ")}`
      : "";

  const entities = await query<Entity>(
    `
    SELECT en.id, en.name, en.entity_type, en.repo, en.updated_at,
           (SELECT count(*)::int FROM memory.edges e
            WHERE (e.source_id = en.id OR e.target_id = en.id) AND e.valid_to IS NULL) as edge_count
    FROM memory.entities en
    ${entityWhere}
    ORDER BY en.updated_at DESC
    LIMIT 50
  `,
    entityParams,
  );

  return (
    <GraphView
      entity={entity}
      type={type}
      showInvalid={showInvalid}
      stats={stats}
      entityTypes={entityTypes}
      entities={entities}
      edges={edges}
    />
  );
}
