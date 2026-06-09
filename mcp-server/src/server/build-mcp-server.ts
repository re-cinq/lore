import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDeps } from "../mcp/tools/deps.js";
import { registerMemoryTools } from "../mcp/tools/memory-tools.js";
import { registerContextTools } from "../mcp/tools/context-tools.js";
import { registerPipelineTools } from "../mcp/tools/pipeline-tools.js";
import { registerRepoTools } from "../mcp/tools/repo-tools.js";
import { registerUsageTools } from "../mcp/tools/usage-tools.js";
import { registerSpecTraceTools } from "../mcp/tools/spec-trace-tools.js";
import { registerLocalRunnerTools } from "../mcp/tools/local-runner-tools.local.js";
import { registerSpecTraceLocalTools } from "../mcp/tools/spec-trace-tools.local.js";

/**
 * Build the McpServer and register every feature's tools. The DB pool is
 * read lazily through deps.getPool because main() creates it after this.
 */
export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "@re-cinq/lore-mcp", version: "0.1.0" });

  registerContextTools(server, deps);
  registerMemoryTools(server, deps);
  registerSpecTraceTools(server, deps);
  registerPipelineTools(server, deps);
  registerUsageTools(server, deps);
  registerRepoTools(server, deps);
  registerLocalRunnerTools(server, deps);
  registerSpecTraceLocalTools(server, deps);

  return server;
}
