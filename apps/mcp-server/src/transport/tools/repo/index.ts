import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerListReposTool } from "./list-repos.js";
import { registerOnboardRepoTool } from "./onboard-repo.js";
import { registerIngestFilesTool } from "./ingest-files.js";
import { registerNextReadyIssueTool } from "./next-ready-issue.js";

export function registerRepoTools(server: McpServer, mode: ServerMode) {
  registerListReposTool(server);
  registerOnboardRepoTool(server);
  registerIngestFilesTool(server, mode);
  registerNextReadyIssueTool(server, mode);
}
