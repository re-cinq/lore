import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVersionsTool } from "./versions.js";

// Which build of every Lore part runs; shared, so agent pods on the gateway can ask too.
export function registerVersionsTools(server: McpServer) {
  registerVersionsTool(server);
}
