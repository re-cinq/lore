import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRunTaskLocallyTool } from "./run-task-locally.local.js";
import { registerListLocalTasksTool } from "./list-local-tasks.local.js";
import { registerCancelLocalTaskTool } from "./cancel-local-task.local.js";
import { registerClaimAndRunLocallyTool } from "./claim-and-run-locally.local.js";
import { registerConfigureLocalRunnerTool } from "./configure-local-runner.local.js";

export function registerLocalRunnerTools(server: McpServer) {
  registerRunTaskLocallyTool(server);
  registerListLocalTasksTool(server);
  registerCancelLocalTaskTool(server);
  registerClaimAndRunLocallyTool(server);
  registerConfigureLocalRunnerTool(server);
}
