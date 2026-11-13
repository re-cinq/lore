import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../shared/deps.js";
import {
  behindText,
  getUpdateStatus,
  runUpdate,
} from "../../../work/update/mcp-update.js";

// lore_update rebuilds the local MCP adapter via scripts/lore-update.sh; on the shared server there's no checkout, so it no-ops and reports that.
export function registerUpdateTool(server: McpServer) {
  server.tool(
    "lore_update",
    `Rebuild the local Lore MCP adapter from the latest origin/main (git pull + npm ci --ignore-scripts + build), and build + install the Lore VS Code extension into any editor CLI on PATH. Run ONLY after the user consents — lore_assemble_context flags "lore_mcp_update_available" when the local MCP is behind the build deployed on lore-api (lore_versions' latest). The rebuild applies on the next Claude Code restart (a running process can't hot-swap its own code).`,
    {},
    async () => {
      const status = await getUpdateStatus();
      const header = status.updateAvailable
        ? `Updating — ${behindText(status)}.\n`
        : "";
      const output = await runUpdate();

      return textResult(
        `${header}${output}\n\nRestart Claude Code to load the rebuilt MCP, and reload the VS Code window if the extension was installed.`,
      );
    },
  );
}
