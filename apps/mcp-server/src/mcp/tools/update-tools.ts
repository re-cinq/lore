import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runUpdate,
  getUpdateStatus,
} from "../../features/update/mcp-update.js";

// lore_update rebuilds the local MCP adapter via scripts/lore-update.sh; on the shared server there's no checkout, so it no-ops and reports that.
export function registerUpdateTools(server: McpServer) {
  server.tool(
    "lore_update",
    `Rebuild the local Lore MCP adapter from the latest origin/main (git pull + npm ci --ignore-scripts + build). Run ONLY after the user consents — lore_assemble_context flags "lore_mcp_update_available" when the local MCP is behind. The rebuild applies on the next Claude Code restart (a running process can't hot-swap its own code).`,
    {},
    async () => {
      const status = await getUpdateStatus();
      const header = status.updateAvailable
        ? `Updating — ${status.commitsBehind} commit(s) behind origin/main.\n`
        : "";
      const output = await runUpdate();

      return {
        content: [
          {
            type: "text" as const,
            text: `${header}${output}\n\nRestart Claude Code to load the rebuilt MCP.`,
          },
        ],
      };
    },
  );
}
