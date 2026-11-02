import { errorMessage, resolveAgentId } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { proxyGetApi, textResult } from "../shared/deps.js";
import { renderProxied } from "../shared/render-proxied.js";
import { apiGetUrl } from "../../api/api-types.js";
import { AGENT_STATS_INPUT } from "../memory/shared/memory-tools-schemas.js";

export function registerAgentStatsTool(server: McpServer) {
  server.tool(
    "lore_agent_stats",
    `Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. Instead: lore_my_usage for per-developer LLM token spend.`,
    AGENT_STATS_INPUT,
    agentStatsHandler,
  );
}

async function agentStatsHandler({ agent_id }: { agent_id?: string }) {
  try {
    const proxied = await proxyGetApi(
      apiGetUrl("/api/agent-stats", { agent_id: resolveAgentId(agent_id) }),
    );

    return renderProxied(proxied, {
      op: "fetching agent stats",
      subject: "agent stats",
      toolName: "lore_agent_stats",
    });
  } catch (err) {
    return textResult(`Error fetching agent stats: ${errorMessage(err)}`);
  }
}
