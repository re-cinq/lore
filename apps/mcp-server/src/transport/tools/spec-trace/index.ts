import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerQueryTraceTool } from "./query-trace.js";

export function registerSpecTraceTools(server: McpServer, mode: ServerMode) {
  registerQueryTraceTool(server, mode);
}
