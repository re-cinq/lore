import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListTestsTool } from "./list-tests.local.js";
import { registerRunTestTool } from "./run-test.local.js";

export function registerSpecTraceLocalTools(server: McpServer) {
  registerListTestsTool(server);
  registerRunTestTool(server);
}
