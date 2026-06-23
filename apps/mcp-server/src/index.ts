import { buildMcpServer } from "./server/build-mcp-server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dumpSessionLog } from "@re-cinq/lore-server-core/platform/session-tracker.js";
import { loadTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { loadDefaultTemplates } from "@re-cinq/lore-server-core/features/context/context-assembly.js";

// The local MCP adapter speaks the MCP protocol over stdio and proxies every
// data operation to the remote Lore API (LORE_API_URL). It holds no DB pool and
// initializes no OpenTelemetry SDK — those heavy remote concerns live in
// @re-cinq/lore-api. Tools read getPool() === null and take their proxy path.
const getPool = () => null;
const server = buildMcpServer({ getPool });

async function main() {
  loadTaskTypes();
  loadDefaultTemplates();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lore] Local MCP adapter ready (stdio) — proxying to LORE_API_URL");

  // Dump session log on exit (for the Stop hook to POST as an episode)
  const exitHandler = () => dumpSessionLog();
  process.on("SIGTERM", exitHandler);
  process.on("SIGINT", exitHandler);
  process.on("beforeExit", exitHandler);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
