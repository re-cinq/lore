import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetPipelineStatusTool } from "./get-pipeline-status.js";
import { registerListPipelineTasksTool } from "./list-pipeline-tasks.js";
import { registerCancelTaskTool } from "./cancel-task.js";
import { registerRetryTaskTool } from "./retry-task.js";
import { registerListTaskGroupTool } from "./list-task-group.js";
import { registerGetTaskLogsTool } from "./get-task-logs.js";
import { registerGetJobLogsTool } from "./get-job-logs.js";

// Registers every lore_* pipeline tool, one file per tool.
export function registerPipelineTools(server: McpServer) {
  registerGetPipelineStatusTool(server);
  registerListPipelineTasksTool(server);
  registerCancelTaskTool(server);
  registerRetryTaskTool(server);
  registerListTaskGroupTool(server);
  registerGetTaskLogsTool(server);
  registerGetJobLogsTool(server);
}
