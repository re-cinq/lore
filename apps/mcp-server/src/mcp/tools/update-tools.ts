import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDeps } from "./deps.js";
import {
  runUpdate,
  getUpdateStatus,
} from "../../features/update/mcp-update.js";

/**
 * lore_update — rebuild the installed local MCP adapter from the latest
 * origin/main. Local-machine only: on the shared server there is no checkout to
 * update, so the underlying git/build no-ops and the tool reports that.
 *
 * Runs the audited scripts/lore-update.sh (git pull + npm ci --ignore-scripts +
 * build shared→server-core→mcp). Meant to be invoked only after the user
 * consents — lore_assemble_context flags `lore_mcp_update_available` when the
 * local MCP is behind.
 */
export function registerUpdateTools(server: McpServer, _deps: ToolDeps) {
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
