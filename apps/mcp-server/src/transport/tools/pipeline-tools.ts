import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPipelineLifecycleTools } from "./pipeline-tools-lifecycle.js";
import { registerPipelineListingTools } from "./pipeline-tools-listing.js";
import { registerSpecTaskTools } from "./pipeline-tools-spec-tasks.js";
import { registerPipelineLogTools } from "./pipeline-tools-logs.js";
import { registerPipelineNotificationTools } from "./pipeline-tools-notifications.js";

// Registers every lore_* pipeline tool; implementations live in pipeline-tools-*.ts, split one file per job.
export function registerPipelineTools(server: McpServer) {
  registerPipelineLifecycleTools(server);
  registerPipelineListingTools(server);
  registerSpecTaskTools(server);
  registerPipelineLogTools(server);
  registerPipelineNotificationTools(server);
}
