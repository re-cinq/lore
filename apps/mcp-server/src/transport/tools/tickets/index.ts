import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { registerSearchTicketsTool } from "./search-tickets.js";

export function registerTicketTools(server: McpServer, mode: ServerMode) {
  registerSearchTicketsTool(server, mode);
}
