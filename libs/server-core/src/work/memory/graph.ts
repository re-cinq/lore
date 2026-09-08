import type { PgPool } from "@re-cinq/lore-shared";

// Live knowledge graph (PostgreSQL-backed)

export interface ExtractedGraphEntity {
  name: string;
  type: string;
}

export interface ExtractedGraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface GraphExtractionResult {
  entities: ExtractedGraphEntity[];
  edges: ExtractedGraphEdge[];
}

// LiveGraphResult relocated to @re-cinq/lore-shared (single source); re-exported below.

// ── LLM entity extraction ──────────────────────────────────────────

const GRAPH_EXTRACTION_PROMPT =
  "Extract entities and relationships from the following text about a software project. " +
  "Return a JSON object with two arrays:\n" +
  '- "entities": [{name: string, type: "service"|"team"|"technology"|"concept"|"person"}]\n' +
  '- "edges": [{source: string, target: string, relation: "uses"|"owns"|"depends-on"|"replaced-by"|"part-of"|"implements"}]\n' +
  "Only include clearly stated relationships. Maximum 10 entities and 10 edges. " +
  "Normalize entity names to lowercase. Return only the JSON object.";

// Entities, lowercased and capped. The case fold is what makes the graph converge: "Floor" and "floor" named by two different episodes have to reach the same node or the graph grows a synonym per writer.
function normalizeEntities(
  raw: Array<{ name?: unknown; type?: unknown }> | undefined,
): ExtractedGraphEntity[] {
  return (raw || [])
    .filter((e) => e.name && e.type)
    .map((e) => ({
      name: String(e.name).toLowerCase().trim(),
      type: String(e.type).toLowerCase().trim(),
    }))
    .slice(0, 10);
}

// Edges, on the same terms — an edge naming an entity in another case would point at a node that does not exist.
function normalizeEdges(
  raw:
    | Array<{ source?: unknown; target?: unknown; relation?: unknown }>
    | undefined,
): ExtractedGraphEdge[] {
  return (raw || [])
    .filter((e) => e.source && e.target && e.relation)
    .map((e) => ({
      source: String(e.source).toLowerCase().trim(),
      target: String(e.target).toLowerCase().trim(),
      relation: String(e.relation).toLowerCase().trim(),
    }))
    .slice(0, 10);
}

export function parseGraphExtraction(raw: string): GraphExtractionResult {
  try {
    const cleaned = raw
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as {
      entities?: Array<{ name?: unknown; type?: unknown }>;
      edges?: Array<{ source?: unknown; target?: unknown; relation?: unknown }>;
    };

    return {
      entities: normalizeEntities(parsed.entities),
      edges: normalizeEdges(parsed.edges),
    };
  } catch {
    return { entities: [], edges: [] };
  }
}

// ── Entity upsert ──────────────────────────────────────────────────

async function upsertEntity(
  pool: PgPool,
  name: string,
  entityType: string,
  repo: string | null,
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO memory.entities (name, entity_type, repo)
     VALUES ($1, $2, $3)
     ON CONFLICT (name, entity_type, COALESCE(repo, ''))
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [name, entityType, repo],
  );

  return rows[0].id as string;
}

// ── Edge upsert with temporal invalidation ─────────────────────────

/** Where a graph write came from: the episode or memory whose text produced it. */
export interface GraphProvenance {
  sourceEpisodeId: string | null;
  sourceMemoryId: string | null;
}

interface EdgeKey {
  sourceId: string;
  targetId: string;
  relationType: string;
}

async function upsertEdge(
  pool: PgPool,
  { sourceId, targetId, relationType }: EdgeKey,
  { sourceEpisodeId, sourceMemoryId }: GraphProvenance,
): Promise<void> {
  // Check if this exact edge already exists and is valid
  const { rows: existing } = await pool.query(
    `SELECT id FROM memory.edges
     WHERE source_id = $1 AND target_id = $2 AND relation_type = $3 AND valid_to IS NULL`,
    [sourceId, targetId, relationType],
  );

  if (existing.length > 0) {
    return;
  }

  await retireContradictoryEdges(pool, sourceId, relationType, targetId);
  await pool.query(
    `INSERT INTO memory.edges (source_id, target_id, relation_type, source_episode_id, source_memory_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [sourceId, targetId, relationType, sourceEpisodeId, sourceMemoryId],
  );
}

// Retires edges that disagree with the one about to be written: same source and relation, different target. Closed by `valid_to` rather than deleted — that a relationship USED to hold is part of what the graph records.
async function retireContradictoryEdges(
  pool: PgPool,
  sourceId: string,
  relationType: string,
  targetId: string,
): Promise<void> {
  await pool.query(
    `UPDATE memory.edges
     SET valid_to = now()
     WHERE source_id = $1 AND relation_type = $2 AND target_id != $3 AND valid_to IS NULL`,
    [sourceId, relationType, targetId],
  );
}

// ── Main extraction entry point ────────────────────────────────────

/** Upserts each entity, skipping (and logging) any that fails, so one bad entity never sinks the batch. */
async function upsertEntities(
  pool: PgPool,
  entities: ExtractedGraphEntity[],
  repo: string | null,
): Promise<Map<string, string>> {
  const entityIds = new Map<string, string>();

  for (const entity of entities) {
    try {
      const id = await upsertEntity(pool, entity.name, entity.type, repo);

      entityIds.set(entity.name, id);
    } catch (err) {
      console.warn(`[graph] Failed to upsert entity "${entity.name}":`, err);
    }
  }

  return entityIds;
}

// The edge's two ends as entity ids, or null when either was not written. An entity that failed its own upsert leaves every edge touching it unwritable — dropped quietly, because the failure was already logged where it happened.
function edgeEndpoints(
  edge: ExtractedGraphEdge,
  entityIds: Map<string, string>,
): { sourceId: string; targetId: string; relationType: string } | null {
  const sourceId = entityIds.get(edge.source);
  const targetId = entityIds.get(edge.target);

  return sourceId && targetId
    ? { sourceId, targetId, relationType: edge.relation }
    : null;
}

/** Upserts each edge whose endpoints resolved to an entity id, skipping (and logging) any that fails; returns how many were written. */
async function upsertEdges(
  pool: PgPool,
  edges: ExtractedGraphEdge[],
  entityIds: Map<string, string>,
  provenance: GraphProvenance,
): Promise<number> {
  let edgeCount = 0;

  for (const edge of edges) {
    const ids = edgeEndpoints(edge, entityIds);

    if (ids && (await tryUpsertEdge(pool, edge, ids, provenance))) {
      edgeCount++;
    }
  }

  return edgeCount;
}

// Whether this edge landed. One bad edge is skipped and logged rather than abandoning the batch — the entities are already written, and half a graph is more use than none.
async function tryUpsertEdge(
  pool: PgPool,
  edge: ExtractedGraphEdge,
  ids: { sourceId: string; targetId: string; relationType: string },
  provenance: GraphProvenance,
): Promise<boolean> {
  try {
    await upsertEdge(pool, ids, provenance);

    return true;
  } catch (err) {
    console.warn(
      `[graph] Failed to upsert edge "${edge.source}" -${edge.relation}-> "${edge.target}":`,
      err,
    );

    return false;
  }
}

// Writes the entities, then the edges between them. Entities FIRST because an edge names its ends by id, and an edge written against an entity that does not exist yet has nothing to point at.
async function applyExtraction(
  pool: PgPool,
  extraction: GraphExtractionResult,
  repo: string | null,
  provenance: GraphProvenance,
): Promise<void> {
  const entityIds = await upsertEntities(pool, extraction.entities, repo);
  const edgeCount = await upsertEdges(
    pool,
    extraction.edges,
    entityIds,
    provenance,
  );

  console.log(
    `[graph] Updated graph: ${extraction.entities.length} entities, ${edgeCount} edges`,
  );
}

// Extract entities and relationships from text and update the graph; called after fact extraction in the ingestion pipeline.
export async function extractAndUpdateGraph(
  pool: PgPool,
  text: string,
  { repo, ...provenance }: GraphProvenance & { repo: string | null },
  llmCall: (prompt: string) => Promise<string>,
): Promise<void> {
  try {
    const raw = await llmCall(`${GRAPH_EXTRACTION_PROMPT}\n\n${text}`);
    const { entities, edges } = parseGraphExtraction(raw);

    if (entities.length === 0) {
      return;
    }
    await applyExtraction(pool, { entities, edges }, repo, provenance);
  } catch (err) {
    console.warn("[graph] Entity extraction failed (non-fatal):", err);
  }
}

// ── Live graph query ────────────────────────────────────────────────

export { queryLiveGraph, type LiveGraphResult } from "@re-cinq/lore-shared";

// Static graph (legacy file-based, fallback when DB is unavailable) — see static-graph.ts
export {
  graphSearchInputSchema,
  getDomainSummaryInputSchema,
  graphSearchHandler,
  getDomainSummaryHandler,
} from "./static-graph.js";
