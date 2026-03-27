import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
  if (entity.name.toLowerCase().includes(lowerQuery)) return true;
  if (entity.id.toLowerCase().includes(lowerQuery)) return true;
  if (entity.type.toLowerCase().includes(lowerQuery)) return true;
  if (entity.aliases) {
    for (const alias of entity.aliases) {
      if (alias.toLowerCase().includes(lowerQuery)) return true;
    }
  }
  return false;
}

function formatEntity(entity: GraphEntity): string {
  return `${entity.type}:${entity.name}`;
}

/**
 * Traverse the graph starting from a set of seed entity IDs, following
 * relationships up to `depth` hops. Returns human-readable traversal chains.
 */
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
  const adjacency = new Map<string, { relType: string; neighborId: string }[]>();
  for (const rel of graph.relationships) {
    if (!adjacency.has(rel.source)) adjacency.set(rel.source, []);
    if (!adjacency.has(rel.target)) adjacency.set(rel.target, []);
    adjacency.get(rel.source)!.push({ relType: rel.type, neighborId: rel.target });
    adjacency.get(rel.target)!.push({ relType: rel.type, neighborId: rel.source });
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
    if (!entity) continue;
    const label = formatEntity(entity);
    queue.push({ entityId: seedId, chain: label, hops: 0 });
    visited.add(seedId);
    // Include the seed entity itself as a result
    chains.push(label);
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.hops >= depth) continue;

    const neighbors = adjacency.get(item.entityId) || [];
    for (const { relType, neighborId } of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);

      const neighbor = entityById.get(neighborId);
      if (!neighbor) continue;

      const newChain = `${item.chain} \u2192 ${relType}:${formatEntity(neighbor)}`;
      chains.push(newChain);
      queue.push({ entityId: neighborId, chain: newChain, hops: item.hops + 1 });
    }
  }

  return chains;
}

// ---------- Tool input schemas ----------

export const graphSearchInputSchema = {
  query: z.string().describe("Search query to match against entity names, types, and aliases."),
  depth: z
    .number()
    .min(1)
    .max(3)
    .default(2)
    .describe("Number of relationship hops to traverse (1-3). Defaults to 2."),
};

export const getDomainSummaryInputSchema = {
  domain: z.string().describe('Domain name to look up (e.g., "payments", "auth").'),
};

// ---------- Tool handlers ----------

/**
 * graph_search: find entities matching a query and traverse relationships.
 */
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
        content: [{ type: "text" as const, text: "Error: failed to parse graph.json." }],
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

    // Remove the bare seed-entity labels (single-node entries) if there are
    // longer chains that already include them, to keep output concise.
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
      content: [{ type: "text" as const, text: `Error during graph search: ${message}` }],
    };
  }
}

/**
 * get_domain_summary: return the prose summary for a community/domain.
 */
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
          { type: "text" as const, text: "Error: failed to parse communities.json." },
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
