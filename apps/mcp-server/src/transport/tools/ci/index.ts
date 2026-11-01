import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerGetCiFailuresTool } from "./get-ci-failures.js";
import { registerGetCiJobLogTool } from "./get-ci-job-log.js";
import { registerGetPrStatusTool } from "./get-pr-status.js";

export function registerCiTools(server: McpServer, mode: ServerMode) {
  registerGetCiFailuresTool(server, mode);
  registerGetCiJobLogTool(server, mode);
  registerGetPrStatusTool(server);
}
