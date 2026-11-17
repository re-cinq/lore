import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerListRunsTool } from "./list-runs.js";
import { registerGetRunTool } from "./get-run.js";
import { registerGetRunNodeLogsTool } from "./get-run-node-logs.js";
import { registerGetRunTranscriptTool } from "./get-run-transcript.js";
import { registerGetRunAssetsTool } from "./get-run-assets.js";
import { registerGetRunBlobTool } from "./get-run-blob.js";

export function registerRunTools(server: McpServer, mode: ServerMode) {
  registerListRunsTool(server, mode);
  registerGetRunTool(server);
  registerGetRunNodeLogsTool(server);
  registerGetRunTranscriptTool(server);
  registerGetRunAssetsTool(server);
  registerGetRunBlobTool(server);
}
