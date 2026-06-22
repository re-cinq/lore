/**
 * Local server entrypoint (developer laptop): speaks the MCP protocol over
 * stdio. Runs pool-less and proxies memory/context/pipeline operations to the
 * remote server via LORE_API_URL, falling back to ~/.lore files when offline.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { boot } from "./boot.js";
import { buildMcpServer } from "./server/build-mcp-server.js";
import { dumpSessionLog } from "./platform/session-tracker.js";

async function main() {
  const getPool = await boot();
  const server = buildMcpServer({ getPool });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Dump session log on exit (for the Stop hook to POST as an episode).
  const exitHandler = () => dumpSessionLog();
  process.on("SIGTERM", exitHandler);
  process.on("SIGINT", exitHandler);
  process.on("beforeExit", exitHandler);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
