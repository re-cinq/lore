import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWriteEpisodeTool } from "./write-episode.js";
import { registerQueryGraphTool } from "./query-graph.js";
import { registerAgentStatsTool } from "./agent-stats.js";

// The knowledge-graph, episode-ingest, and agent-stats tools — the read-and-observe half of agent memory.
export function registerGraphEpisodeTools(server: McpServer) {
  registerWriteEpisodeTool(server);
  registerQueryGraphTool(server);
  registerAgentStatsTool(server);
}
