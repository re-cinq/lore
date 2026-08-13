import { buildMcpServer } from "./server/build-mcp-server.js";
import { startHttpGateway } from "./server/http-transport.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dumpSessionLog } from "@re-cinq/lore-server-core/platform/session-tracker.js";
import { loadTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { loadDefaultTemplates } from "@re-cinq/lore-server-core/features/context/context-assembly.js";

// The local MCP adapter speaks the MCP protocol over stdio and proxies every
// data operation to the remote Lore API (LORE_API_URL). It holds no DB pool and
// initializes no OpenTelemetry SDK — those heavy remote concerns live in
// @re-cinq/lore-api, so every tool has exactly one path: the proxy.
//
// With LORE_MCP_HTTP=1 it instead serves MCP over Streamable HTTP as a shared
// gateway for headless agent pods (server/http-transport.ts).

async function main() {
  loadTaskTypes();
  loadDefaultTemplates();

  if (
    process.env.LORE_MCP_HTTP === "1" ||
    process.env.LORE_MCP_HTTP === "true"
  ) {
    startHttpGateway({
      port: Number.parseInt(process.env.LORE_MCP_PORT ?? "8080", 10),
      authToken: process.env.LORE_MCP_AUTH_TOKEN,
      serverMode:
        process.env.LORE_MCP_SERVER_MODE === "agent" ? "agent" : "full",
    });

    return;
  }

  const server = buildMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(
    "[lore] Local MCP adapter ready (stdio) — proxying to LORE_API_URL",
  );

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
