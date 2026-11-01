import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  trackLatency,
  proxyGetApi,
  withReadCache,
  textResult,
} from "../shared/deps.js";
import { QUERY_GRAPH_INPUT } from "../memory/shared/memory-tools-schemas.js";
import { interpretMemoryProxy } from "../memory/shared/interpret-memory-proxy.js";

interface GraphQueryArgs {
  entity?: string;
  relation_type?: string;
  repo?: string;
  include_invalidated?: boolean;
}

export function registerQueryGraphTool(server: McpServer) {
  server.tool(
    "lore_query_graph",
    `Reads the live knowledge graph and returns typed relationship edges {entity, entity_type, relation, related_entity, related_type, direction, valid_from} for one entity, or recent edges when no entity given. Use when you want structured relationships (uses/owns/depends-on/replaced-by), not prose. Graph is populated asynchronously by lore_write_episode — no writes here. Instead: lore_search_memory for learnings and facts in prose form; lore_search_context for raw document passages; lore_assemble_context for the token-budgeted startup bundle.`,
    QUERY_GRAPH_INPUT,
    async (args) => trackLatency("lore_query_graph", () => queryGraph(args)),
  );
}

/** Reads the graph through the API — the adapter holds no pool even in stdio mode, so an unconfigured LORE_API_URL leaves nothing to read and says so rather than reporting an empty graph. */
async function queryGraph(args: {
  entity?: string;
  relation_type?: string;
  repo?: string;
  include_invalidated?: boolean;
}) {
  const params = buildGraphQueryParams(args);
  const proxied = await withReadCache(graphReadSpec(args), () =>
    proxyGetApi(`/api/graph?${params.toString()}`),
  );

  return (
    interpretMemoryProxy("lore_query_graph", proxied) ??
    textResult(
      "Knowledge graph requires PostgreSQL (LORE_DB_HOST) or a configured LORE_API_URL.",
    )
  );
}

function buildGraphQueryParams(args: GraphQueryArgs): URLSearchParams {
  const params = new URLSearchParams();

  if (args.entity) {
    params.set("entity", args.entity);
  }

  if (args.relation_type) {
    params.set("relation_type", args.relation_type);
  }

  if (args.repo) {
    params.set("repo", args.repo);
  }

  if (args.include_invalidated) {
    params.set("include_invalidated", "true");
  }

  return params;
}

// Cached like assemble, for ten minutes: edges change only when an episode is ingested, which is minutes-scale work — a shorter window would re-fetch a graph that cannot have moved.
function graphReadSpec(args: GraphQueryArgs) {
  return {
    tool: "lore_query_graph" as const,
    args: { ...args },
    repo: args.repo || undefined,
    ttlSeconds: 600,
  };
}
