import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dumpSessionLog } from "@re-cinq/lore-server-core/platform/session-tracker.js";
import { startHttpServer } from "./http-server.js";

/**
 * Select how the process runs, based on MCP_TRANSPORT: stdio (local) serves
 * the MCP protocol over a stdio transport; http (GKE) starts the REST /api/*
 * backend that the local stdio adapter proxies to (no MCP-over-HTTP — the
 * former /mcp endpoint was removed).
 */
export async function startTransport(server: McpServer, getPool: () => any): Promise<void> {
  const mode = process.env.MCP_TRANSPORT || "stdio";

  if (mode === "http") {
    await startHttpServer(getPool);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Dump session log on exit (for Stop hook to POST as episode)
  const exitHandler = () => dumpSessionLog();
  process.on("SIGTERM", exitHandler);
  process.on("SIGINT", exitHandler);
  process.on("beforeExit", exitHandler);
}
