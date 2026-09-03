import { z } from "zod";
import type { PgPool } from "@re-cinq/lore-shared";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Live knowledge graph (PostgreSQL-backed)

interface ExtractedGraphEntity {
  name: string;
  type: string;
}

interface ExtractedGraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface GraphExtractionResult {
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

function parseGraphExtraction(raw: string): GraphExtractionResult {
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

async function upsertEdge(
  pool: PgPool,
  sourceId: string,
  targetId: string,
  relationType: string,
  sourceEpisodeId: string | null,
  sourceMemoryId: string | null,
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

// Extract entities and relationships from text and update the graph; called after fact extraction in the ingestion pipeline.
export async function extractAndUpdateGraph(
  pool: PgPool,
  text: string,
  repo: string | null,
  sourceEpisodeId: string | null,
  sourceMemoryId: string | null,
  llmCall: (prompt: string) => Promise<string>,
): Promise<void> {
  try {
    const raw = await llmCall(`${GRAPH_EXTRACTION_PROMPT}\n\n${text}`);
    const { entities, edges } = parseGraphExtraction(raw);

    if (entities.length === 0) {
      return;
    }

    const entityIds = new Map<string, string>();

    for (const entity of entities) {
      try {
        const id = await upsertEntity(pool, entity.name, entity.type, repo);

        entityIds.set(entity.name, id);
      } catch (err) {
        console.warn(`[graph] Failed to upsert entity "${entity.name}":`, err);
      }
    }

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
          sourceId,
          targetId,
          edge.relation,
          sourceEpisodeId,
          sourceMemoryId,
        );
        edgeCount++;
      } catch (err) {
        console.warn(
          `[graph] Failed to upsert edge "${edge.source}" -${edge.relation}-> "${edge.target}":`,
          err,
        );
      }
    }

    console.log(
      `[graph] Updated graph: ${entities.length} entities, ${edgeCount} edges`,
    );
  } catch (err) {
    console.warn("[graph] Entity extraction failed (non-fatal):", err);
  }
}

// ── Live graph query ────────────────────────────────────────────────

export { queryLiveGraph, type LiveGraphResult } from "@re-cinq/lore-shared";

// Static graph (legacy file-based, fallback when DB is unavailable)

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

const GRAPHRAG_NOT_BUILT =
  "GraphRAG hasn't been built yet. This feature requires 3+ months of accumulated content before the knowledge graph can be generated.";

// ---------- Types ----------

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  aliases?: string[];
}

interface GraphRelationship {
  source: string;
  target: string;
  type: string;
}

interface Graph {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
}

interface Community {
  domain: string;
  summary: string;
}

// ---------- Helpers ----------

function readJsonSafe<T>(path: string): T | null {
  try {
    const raw = readFileSync(path, "utf-8");

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function entityMatchesQuery(entity: GraphEntity, lowerQuery: string): boolean {
  if (entity.name.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  if (entity.id.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  if (entity.type.toLowerCase().includes(lowerQuery)) {
    return true;
  }

  return (entity.aliases ?? []).some((alias) =>
    alias.toLowerCase().includes(lowerQuery),
  );
}

function formatEntity(entity: GraphEntity): string {
  return `${entity.type}:${entity.name}`;
}

// Traverse the graph from a set of seed entity IDs, following relationships up to `depth` hops; returns human-readable traversal chains.
function traverseGraph(
  graph: Graph,
  seedIds: Set<string>,
  depth: number,
): string[] {
  const entityById = new Map<string, GraphEntity>();

  for (const e of graph.entities) {
    entityById.set(e.id, e);
  }

  // Adjacency: entityId -> list of { relType, neighborId }
  const adjacency = new Map<
    string,
    { relType: string; neighborId: string }[]
  >();

  for (const rel of graph.relationships) {
    if (!adjacency.has(rel.source)) {
      adjacency.set(rel.source, []);
    }

    if (!adjacency.has(rel.target)) {
      adjacency.set(rel.target, []);
    }
    adjacency
      .get(rel.source)!
      .push({ relType: rel.type, neighborId: rel.target });
    adjacency
      .get(rel.target)!
      .push({ relType: rel.type, neighborId: rel.source });
  }

  // BFS up to `depth` hops, collecting chains
  const chains: string[] = [];
  const visited = new Set<string>();

  interface QueueItem {
    entityId: string;
    chain: string;
    hops: number;
  }

  const queue: QueueItem[] = [];

  for (const seedId of seedIds) {
    const entity = entityById.get(seedId);

    if (!entity) {
      continue;
    }
    const label = formatEntity(entity);

    queue.push({ entityId: seedId, chain: label, hops: 0 });
    visited.add(seedId);
    // Include the seed entity itself as a result
    chains.push(label);
  }

  const expandNeighbors = (item: QueueItem): void => {
    for (const { relType, neighborId } of adjacency.get(item.entityId) || []) {
      if (visited.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);

      const neighbor = entityById.get(neighborId);

      if (!neighbor) {
        continue;
      }

      const newChain = `${item.chain} \u2192 ${relType}:${formatEntity(neighbor)}`;

      chains.push(newChain);
      queue.push({
        entityId: neighborId,
        chain: newChain,
        hops: item.hops + 1,
      });
    }
  };

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (item.hops >= depth) {
      continue;
    }
    expandNeighbors(item);
  }

  return chains;
}

// ---------- Tool input schemas ----------

export const graphSearchInputSchema = {
  query: z
    .string()
    .describe(
      "Search query to match against entity names, types, and aliases.",
    ),
  depth: z
    .number()
    .min(1)
    .max(3)
    .default(2)
    .describe("Number of relationship hops to traverse (1-3). Defaults to 2."),
};

export const getDomainSummaryInputSchema = {
  domain: z
    .string()
    .describe('Domain name to look up (e.g., "payments", "auth").'),
};

// ---------- Tool handlers ----------

// graph_search: find entities matching a query and traverse relationships.
export async function graphSearchHandler({
  query,
  depth,
}: {
  query: string;
  depth: number;
}): Promise<{ content: { type: "text"; text: string }[] }> {
  try {
    const graphPath = join(CONTEXT_PATH, "graphrag", "graph.json");

    if (!existsSync(graphPath)) {
      return { content: [{ type: "text" as const, text: GRAPHRAG_NOT_BUILT }] };
    }

    const graph = readJsonSafe<Graph>(graphPath);

    if (!graph) {
      return {
        content: [
          { type: "text" as const, text: "Error: failed to parse graph.json." },
        ],
      };
    }

    if (!graph.entities || !graph.relationships) {
      return {
        content: [
          {
            type: "text" as const,
            text: 'Error: graph.json is missing required "entities" or "relationships" fields.',
          },
        ],
      };
    }

    const lowerQuery = query.toLowerCase();
    const matchingIds = new Set<string>();

    for (const entity of graph.entities) {
      if (entityMatchesQuery(entity, lowerQuery)) {
        matchingIds.add(entity.id);
      }
    }

    if (matchingIds.size === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No entities found matching "${query}". Try a broader search term.`,
          },
        ],
      };
    }

    const chains = traverseGraph(graph, matchingIds, depth);

    // Remove bare seed-entity labels when longer chains already include them, to keep output concise.
    const traversalChains = chains.filter((c) => c.includes("\u2192"));
    const output =
      traversalChains.length > 0
        ? traversalChains.join("\n")
        : chains.join("\n");

    const header = `Found ${matchingIds.size} matching entit${matchingIds.size === 1 ? "y" : "ies"}, depth=${depth}:\n\n`;

    return { content: [{ type: "text" as const, text: header + output }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    return {
      content: [
        {
          type: "text" as const,
          text: `Error during graph search: ${message}`,
        },
      ],
    };
  }
}

// get_domain_summary: return the prose summary for a community/domain.
export async function getDomainSummaryHandler({
  domain,
}: {
  domain: string;
}): Promise<{ content: { type: "text"; text: string }[] }> {
  try {
    const communitiesPath = join(CONTEXT_PATH, "graphrag", "communities.json");

    if (!existsSync(communitiesPath)) {
      return { content: [{ type: "text" as const, text: GRAPHRAG_NOT_BUILT }] };
    }

    const communities = readJsonSafe<Community[]>(communitiesPath);

    if (!communities) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: failed to parse communities.json.",
          },
        ],
      };
    }

    if (!Array.isArray(communities)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: communities.json should contain a JSON array of community objects.",
          },
        ],
      };
    }

    const lowerDomain = domain.toLowerCase();
    const match = communities.find(
      (c) => c.domain && c.domain.toLowerCase() === lowerDomain,
    );

    if (!match) {
      const available = communities
        .map((c) => c.domain)
        .filter(Boolean)
        .join(", ");

      return {
        content: [
          {
            type: "text" as const,
            text: `No community found for domain "${domain}".${available ? ` Available domains: ${available}.` : ""}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `## Domain: ${match.domain}\n\n${match.summary}`,
        },
      ],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    return {
      content: [
        {
          type: "text" as const,
          text: `Error retrieving domain summary: ${message}`,
        },
      ],
    };
  }
}
