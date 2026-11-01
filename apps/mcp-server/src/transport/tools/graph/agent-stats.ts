import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  proxyGetApi,
  deniedError,
  unconfiguredError,
  textResult,
} from "../shared/deps.js";
import { AGENT_STATS_INPUT } from "../memory/shared/memory-tools-schemas.js";

export function registerAgentStatsTool(server: McpServer) {
  server.tool(
    "lore_agent_stats",
    `Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. Instead: lore_my_usage for per-developer LLM token spend.`,
    AGENT_STATS_INPUT,
    agentStatsHandler,
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
