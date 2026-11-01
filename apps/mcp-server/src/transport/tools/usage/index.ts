import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMyUsageTool } from "./my-usage.js";
import { registerGetAnalyticsTool } from "./get-analytics.js";

export function registerUsageTools(server: McpServer) {
  registerMyUsageTool(server);
  registerGetAnalyticsTool(server);
}
