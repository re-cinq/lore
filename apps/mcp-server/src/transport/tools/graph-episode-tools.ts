import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  trackLatency,
  proxyToApi,
  proxyGetApi,
  withReadCache,
  deniedError,
  unconfiguredError,
  textResult,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import {
  WRITE_EPISODE_INPUT,
  QUERY_GRAPH_INPUT,
  AGENT_STATS_INPUT,
} from "./memory-tools-schemas.js";
import { interpretMemoryProxy } from "./interpret-memory-proxy.js";

// The knowledge-graph, episode-ingest, and agent-stats tools — the read-and-observe half of agent memory.

const EPISODE_DERIVED_READS = [
  "lore_search_memory",
  "lore_query_graph",
  "lore_assemble_context",
];

export function registerGraphEpisodeTools(server: McpServer) {
  registerWriteEpisodeTool(server);
  registerQueryGraphTool(server);
  registerAgentStatsTool(server);
}

// No file fallback: an episode is only useful once its facts and graph entities have been extracted, and that happens server-side. Saying so beats writing a blob nowhere reads.
interface WriteEpisodeArgs {
  content: string;
  source: string;
  ref?: string;
  agent_id?: string;
}

async function writeEpisodeHandler(args: WriteEpisodeArgs) {
  try {
    const handled = interpretMemoryProxy(
      "lore_write_episode",
      await proxyToApi("/api/episode", {
        ...args,
        agent_id: args.agent_id || resolveAgentId(),
      }),
      () => invalidateCache(EPISODE_DERIVED_READS),
    );

    return (
      handled ??
      textResult(
        "Episodes require PostgreSQL or LORE_API_URL. Neither is configured.",
      )
    );
  } catch (err) {
    return textResult(`Error writing episode: ${errorMessage(err)}`);
  }
}

function registerWriteEpisodeTool(server: McpServer) {
  server.tool(
    "lore_write_episode",
    `Ingests one raw uncurated text blob as a deduplicated episode; returns {status: "ok", episode_id, source, ref} or {status: "duplicate"} when already ingested. Content is secret-redacted; facts and graph entities/edges are extracted asynchronously. Use for bulk/passive capture where you do not want to choose a key and do not need the text individually addressable. Instead: lore_write_memory for a curated nugget you want to retrieve by a specific key. No file fallback — requires DB or API.`,
    WRITE_EPISODE_INPUT,
    writeEpisodeHandler,
  );
}

interface GraphQueryArgs {
  entity?: string;
  relation_type?: string;
  repo?: string;
  include_invalidated?: boolean;
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

function registerQueryGraphTool(server: McpServer) {
  server.tool(
    "lore_query_graph",
    `Reads the live knowledge graph and returns typed relationship edges {entity, entity_type, relation, related_entity, related_type, direction, valid_from} for one entity, or recent edges when no entity given. Use when you want structured relationships (uses/owns/depends-on/replaced-by), not prose. Graph is populated asynchronously by lore_write_episode — no writes here. Instead: lore_search_memory for learnings and facts in prose form; lore_search_context for raw document passages; lore_assemble_context for the token-budgeted startup bundle.`,
    QUERY_GRAPH_INPUT,
    async (args) =>
      trackLatency("lore_query_graph", async () => {
        try {
          return await queryGraph(args);
        } catch (err) {
          return textResult(`Error querying graph: ${errorMessage(err)}`);
        }
      }),
  );
}

// Reads an agent's own figures. The three refusals are distinct on purpose: unconfigured means this install has no API, denied means the token was rejected, and anything else is the API's own message — collapsing them would send a developer to check the wrong thing.
async function agentStatsHandler({ agent_id }: { agent_id?: string }) {
  try {
    const params = new URLSearchParams({ agent_id: resolveAgentId(agent_id) });
    const proxied = await proxyGetApi(`/api/agent-stats?${params}`);

    if (proxied.ok) {
      return textResult(JSON.stringify(JSON.parse(proxied.body), null, 2));
    }

    return statsRefusal(proxied);
  } catch (err) {
    return textResult(`Error fetching agent stats: ${errorMessage(err)}`);
  }
}

// Why the figures did not arrive.
function statsRefusal(
  proxied: Exclude<Awaited<ReturnType<typeof proxyGetApi>>, { ok: true }>,
) {
  if (proxied.reason === "not_configured") {
    return unconfiguredError("fetching agent stats");
  }

  if (proxied.reason === "denied") {
    return deniedError("lore_agent_stats", proxied.detail);
  }

  return textResult(
    `Could not fetch agent stats from the Lore API: ${proxied.detail}`,
  );
}

function registerAgentStatsTool(server: McpServer) {
  server.tool(
    "lore_agent_stats",
    `Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. Instead: lore_my_usage for per-developer LLM token spend.`,
    AGENT_STATS_INPUT,
    agentStatsHandler,
  );
}
