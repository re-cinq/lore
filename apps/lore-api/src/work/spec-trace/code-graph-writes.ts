import type { Pool } from "pg";
import type { DerivedEdge } from "./derive-code-graph.js";

type EntityEntry = { name: string; type: string; repo: string | null };

const NO_IMPORTER = "none";

const UPSERT_ENTITIES_SQL = `INSERT INTO memory.entities (name, entity_type, repo)
  SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
  ON CONFLICT (name, entity_type, COALESCE(repo, ''))
  DO UPDATE SET updated_at = now()
  RETURNING id, name, entity_type, repo`;

// An unchanged edge is left alone, so re-ingesting an unchanged repo writes nothing.
const UPSERT_EDGES_SQL = `WITH incoming AS (
    SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::jsonb[])
      AS i(source_id, target_id, relation_type, properties)
  ),
  refreshed AS (
    UPDATE memory.edges e SET properties = i.properties
    FROM incoming i
    WHERE e.source_id = i.source_id AND e.target_id = i.target_id
      AND e.relation_type = i.relation_type AND e.valid_to IS NULL
      AND e.properties IS DISTINCT FROM i.properties
  )
  INSERT INTO memory.edges (source_id, target_id, relation_type, properties)
  SELECT DISTINCT ON (source_id, target_id, relation_type) * FROM incoming i
  WHERE NOT EXISTS (
    SELECT 1 FROM memory.edges e
    WHERE e.source_id = i.source_id AND e.target_id = i.target_id
      AND e.relation_type = i.relation_type AND e.valid_to IS NULL
  )`;

const SETTLE_SENTINELS_SQL = `WITH none_entity AS (
    INSERT INTO memory.entities (name, entity_type) VALUES ($2, $2)
    ON CONFLICT (name, entity_type, COALESCE(repo, ''))
    DO UPDATE SET updated_at = now()
    RETURNING id
  ),
  symbol AS (
    SELECT t.id,
      EXISTS (
        SELECT 1 FROM memory.edges u
        WHERE u.target_id = t.id AND u.relation_type = 'uses' AND u.valid_to IS NULL
          AND u.source_id <> (SELECT id FROM none_entity)
      ) AS imported,
      EXISTS (
        SELECT 1 FROM memory.edges x
        WHERE x.target_id = t.id AND x.relation_type = 'exports' AND x.valid_to IS NULL
      ) AS exported
    FROM memory.entities t
    WHERE t.name = ANY($1::text[]) AND t.entity_type = 'symbol' AND t.repo IS NULL
  ),
  retired AS (
    UPDATE memory.edges e SET valid_to = now()
    FROM symbol s
    WHERE e.target_id = s.id AND s.imported AND e.relation_type = 'uses'
      AND e.valid_to IS NULL AND e.source_id = (SELECT id FROM none_entity)
  )
  INSERT INTO memory.edges (source_id, target_id, relation_type)
  SELECT (SELECT id FROM none_entity), s.id, 'uses' FROM symbol s
  WHERE s.exported AND NOT s.imported
    AND NOT EXISTS (
      SELECT 1 FROM memory.edges e
      WHERE e.target_id = s.id AND e.relation_type = 'uses'
        AND e.valid_to IS NULL AND e.source_id = (SELECT id FROM none_entity)
    )`;

/** Upsert every edge's entities, then its edge, in two statements however many files the batch held. */
export async function writeEdges(
  pool: Pool,
  edges: DerivedEdge[],
): Promise<void> {
  const ids = await upsertEntities(pool, uniqueEntities(edges));
  const idOf = (name: string, type: string, repo: string | null) =>
    ids.get(entityKey(name, type, repo));

  await pool.query(UPSERT_EDGES_SQL, [
    edges.map((e) => idOf(e.sourceName, e.sourceType, e.sourceRepo)),
    edges.map((e) => idOf(e.targetName, e.targetType, e.targetRepo)),
    edges.map((e) => e.relation),
    edges.map((e) => JSON.stringify(e.properties)),
  ]);
}

/** An exported symbol nothing imports gets a `uses` edge from `none` ("derived, no importers" ≠ "never derived"), retired once any repo imports it. */
export async function settleNoImporterSentinels(
  pool: Pool,
  edges: DerivedEdge[],
): Promise<void> {
  const symbols = edges
    .filter((e) => e.relation === "exports" || e.relation === "uses")
    .map((e) => e.targetName);

  await pool.query(SETTLE_SENTINELS_SQL, [[...new Set(symbols)], NO_IMPORTER]);
}

function uniqueEntities(edges: DerivedEdge[]): EntityEntry[] {
  const ends = edges.flatMap((e) => [
    { name: e.sourceName, type: e.sourceType, repo: e.sourceRepo },
    { name: e.targetName, type: e.targetType, repo: e.targetRepo },
  ]);

  return [
    ...new Map(
      ends.map((end) => [entityKey(end.name, end.type, end.repo), end]),
    ).values(),
  ];
}

async function upsertEntities(
  pool: Pool,
  entities: EntityEntry[],
): Promise<Map<string, string>> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    entity_type: string;
    repo: string | null;
  }>(UPSERT_ENTITIES_SQL, [
    entities.map((e) => e.name),
    entities.map((e) => e.type),
    entities.map((e) => e.repo),
  ]);

  return new Map(
    rows.map((r) => [entityKey(r.name, r.entity_type, r.repo), r.id]),
  );
}

function entityKey(name: string, type: string, repo: string | null): string {
  return `${name}\0${type}\0${repo ?? ""}`;
}
