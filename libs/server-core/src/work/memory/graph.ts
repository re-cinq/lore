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
    const entities: ExtractedGraphEntity[] = (parsed.entities || [])
      .filter((e) => e.name && e.type)
      .map((e) => ({
        name: String(e.name).toLowerCase().trim(),
        type: String(e.type).toLowerCase().trim(),
      }))
      .slice(0, 10);
    const edges: ExtractedGraphEdge[] = (parsed.edges || [])
      .filter((e) => e.source && e.target && e.relation)
      .map((e) => ({
        source: String(e.source).toLowerCase().trim(),
        target: String(e.target).toLowerCase().trim(),
        relation: String(e.relation).toLowerCase().trim(),
      }))
      .slice(0, 10);

    return { entities, edges };
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

  // Invalidate contradictory edges (same source + relation, different target)
  await pool.query(
    `UPDATE memory.edges
     SET valid_to = now()
     WHERE source_id = $1 AND relation_type = $2 AND target_id != $3 AND valid_to IS NULL`,
    [sourceId, relationType, targetId],
  );

  await pool.query(
    `INSERT INTO memory.edges (source_id, target_id, relation_type, source_episode_id, source_memory_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [sourceId, targetId, relationType, sourceEpisodeId, sourceMemoryId],
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

/** Upserts each edge whose endpoints resolved to an entity id, skipping (and logging) any that fails; returns how many were written. */
async function upsertEdges(
  pool: PgPool,
  edges: ExtractedGraphEdge[],
  entityIds: Map<string, string>,
  provenance: GraphProvenance,
): Promise<number> {
  let edgeCount = 0;

  for (const edge of edges) {
    const sourceId = entityIds.get(edge.source);
    const targetId = entityIds.get(edge.target);

    if (!sourceId || !targetId) {
      continue;
    }

    try {
      await upsertEdge(
        pool,
        { sourceId, targetId, relationType: edge.relation },
        provenance,
      );
      edgeCount++;
    } catch (err) {
      console.warn(
        `[graph] Failed to upsert edge "${edge.source}" -${edge.relation}-> "${edge.target}":`,
        err,
      );
    }
  }

  return edgeCount;
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

    const entityIds = await upsertEntities(pool, entities, repo);
    const edgeCount = await upsertEdges(pool, edges, entityIds, provenance);

    console.log(
      `[graph] Updated graph: ${entities.length} entities, ${edgeCount} edges`,
    );
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
