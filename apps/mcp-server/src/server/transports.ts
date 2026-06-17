import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dumpSessionLog } from "../platform/session-tracker.js";
import { startHttpServer } from "./http-server.js";

/**
 * Select the transport (stdio for local, Streamable-HTTP for GKE) based on
 * MCP_TRANSPORT and connect the server.
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
