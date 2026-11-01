import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerSearchContextTool } from "./search-context.js";
import { registerAssembleContextTool } from "./assemble-context.js";

export function registerContextTools(server: McpServer, mode: ServerMode) {
  registerSearchContextTool(server, mode);
  registerAssembleContextTool(server, mode);
}
