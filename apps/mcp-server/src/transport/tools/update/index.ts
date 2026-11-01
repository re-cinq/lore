import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerUpdateTool } from "./update.js";

export function registerUpdateTools(server: McpServer) {
  registerUpdateTool(server);
}
