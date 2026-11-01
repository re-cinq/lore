import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerGraphEpisodeTools } from "../graph/index.js";
import { registerWriteMemoryTool } from "./write-memory.js";
import { registerReadMemoryTool } from "./read-memory.js";
import { registerDeleteMemoryTool } from "./delete-memory.js";
import { registerListMemoriesTool } from "./list-memories.js";
import { registerSearchMemoryTool } from "./search-memory.js";

export function registerMemoryTools(server: McpServer, mode: ServerMode) {
  registerWriteMemoryTool(server, mode);
  registerReadMemoryTool(server);
  registerDeleteMemoryTool(server);
  registerListMemoriesTool(server, mode);
  registerSearchMemoryTool(server, mode);
  registerGraphEpisodeTools(server);
}
