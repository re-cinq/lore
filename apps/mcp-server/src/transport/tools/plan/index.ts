import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPlanReadTool } from "./plan-read.js";
import { registerPlanEditTool } from "./plan-edit.js";

export function registerPlanTools(server: McpServer) {
  registerPlanReadTool(server);
  registerPlanEditTool(server);
}
