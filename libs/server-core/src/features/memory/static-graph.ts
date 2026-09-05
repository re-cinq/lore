import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
interface TraversalNode {
  entityId: string;
  chain: string;
  hops: number;
}

/** Undirected adjacency: a relationship is walkable from either end, so "what is connected to X" does not depend on which side of the edge X was written on. */
function adjacencyOf(
  graph: Graph,
): Map<string, { relType: string; neighborId: string }[]> {
  const adjacency = new Map<
    string,
    { relType: string; neighborId: string }[]
  >();
  const link = (from: string, relType: string, neighborId: string) => {
    const edges = adjacency.get(from) ?? [];

    edges.push({ relType, neighborId });
    adjacency.set(from, edges);
  };

  for (const rel of graph.relationships) {
    link(rel.source, rel.type, rel.target);
    link(rel.target, rel.type, rel.source);
  }

  return adjacency;
}

/** BFS out from the seeds, up to `depth` hops, collecting the chain of labels walked to reach each entity; one visit per entity, so a chain is its shortest path. */
function traverseGraph(
  graph: Graph,
  seedIds: Set<string>,
  depth: number,
): string[] {
  const entityById = new Map(graph.entities.map((e) => [e.id, e]));
  const adjacency = adjacencyOf(graph);
  const chains: string[] = [];
  const visited = new Set<string>();
  const queue: TraversalNode[] = [];

  for (const seedId of seedIds) {
    const entity = entityById.get(seedId);

    if (entity) {
      const label = formatEntity(entity);

      queue.push({ entityId: seedId, chain: label, hops: 0 });
      visited.add(seedId);
      // The seed entity is itself a result, not only a starting point.
      chains.push(label);
    }
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    const next =
      node.hops < depth
        ? unvisitedNeighbors(node, adjacency, entityById, visited)
        : [];

    chains.push(...next.map((n) => n.chain));
    queue.push(...next);
  }

  return chains;
}

function unvisitedNeighbors(
  node: TraversalNode,
  adjacency: Map<string, { relType: string; neighborId: string }[]>,
  entityById: Map<string, GraphEntity>,
  visited: Set<string>,
): TraversalNode[] {
  const found: TraversalNode[] = [];

  for (const { relType, neighborId } of adjacency.get(node.entityId) ?? []) {
    const neighbor = visited.has(neighborId)
      ? undefined
      : entityById.get(neighborId);

    visited.add(neighborId);

    if (neighbor) {
      found.push({
        entityId: neighborId,
        chain: `${node.chain} → ${relType}:${formatEntity(neighbor)}`,
        hops: node.hops + 1,
      });
    }
  }

  return found;
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
    const graph = loadGraph();

    if (typeof graph === "string") {
      return text(graph);
    }
    const lowerQuery = query.toLowerCase();
    const matchingIds = new Set(
      graph.entities
        .filter((entity) => entityMatchesQuery(entity, lowerQuery))
        .map((entity) => entity.id),
    );

    if (matchingIds.size === 0) {
      return text(
        `No entities found matching "${query}". Try a broader search term.`,
      );
    }
    const chains = traverseGraph(graph, matchingIds, depth);
    // Bare seed labels are dropped when longer chains already contain them, to keep the output concise.
    const traversal = chains.filter((c) => c.includes("→"));
    const noun = matchingIds.size === 1 ? "entity" : "entities";

    return text(
      `Found ${matchingIds.size} matching ${noun}, depth=${depth}:\n\n` +
        (traversal.length > 0 ? traversal : chains).join("\n"),
    );
  } catch (err: unknown) {
    return text(`Error reading graph: ${errorMessage(err)}`);
  }
}

/** The MCP content envelope these two handlers answer in. */
function text(message: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: message }] };
}

/** Normalizes a caught value to a display string, without assuming it's an Error. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The static graph, or the message explaining why there is none to read. */
function loadGraph(): Graph | string {
  const graphPath = join(CONTEXT_PATH, "graphrag", "graph.json");

  if (!existsSync(graphPath)) {
    return GRAPHRAG_NOT_BUILT;
  }
  const graph = readJsonSafe<Graph>(graphPath);

  if (!graph) {
    return "Error: failed to parse graph.json.";
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- graph.json is arbitrary JSON off disk; the Graph type is a claim, not a guarantee, about what a hand-edited or stale file actually contains
  return graph.entities && graph.relationships
    ? graph
    : 'Error: graph.json is missing required "entities" or "relationships" fields.';
}

// get_domain_summary: return the prose summary for a community/domain.
export async function getDomainSummaryHandler({
  domain,
}: {
  domain: string;
}): Promise<{ content: { type: "text"; text: string }[] }> {
  try {
    const communities = loadCommunities();

    if (typeof communities === "string") {
      return text(communities);
    }
    const lowerDomain = domain.toLowerCase();
    const match = communities.find(
      (c) => c.domain && c.domain.toLowerCase() === lowerDomain,
    );

    if (match) {
      return text(`## Domain: ${match.domain}\n\n${match.summary}`);
    }
    // Naming what IS available turns a miss into a usable answer.
    const available = communities
      .map((c) => c.domain)
      .filter(Boolean)
      .join(", ");

    return text(
      `No community found for domain "${domain}".${available ? ` Available domains: ${available}.` : ""}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    return text(`Error retrieving domain summary: ${message}`);
  }
}

/** The community summaries, or the message explaining why there are none to read. */
function loadCommunities(): Community[] | string {
  const communitiesPath = join(CONTEXT_PATH, "graphrag", "communities.json");

  if (!existsSync(communitiesPath)) {
    return GRAPHRAG_NOT_BUILT;
  }
  const communities = readJsonSafe<Community[]>(communitiesPath);

  if (!communities) {
    return "Error: failed to parse communities.json.";
  }

  return Array.isArray(communities)
    ? communities
    : "Error: communities.json should contain a JSON array of community objects.";
}
