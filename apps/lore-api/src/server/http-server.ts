import type { Pool } from "pg";
import { buildServer } from "./build-server.js";

/**
 * Start the Lore API (/api/*) on the configured PORT. A plain HTTPS REST
 * backend; the MCP protocol is served separately by the local stdio adapter
 * (@re-cinq/lore-mcp), which proxies to these routes. Construction (routes and
 * plugins) lives in `buildServer` — the one factory shared with the tests.
 */
export async function startHttpServer(getPool: () => Pool | null): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);
  const server = buildServer(getPool, port);

  process.on("SIGTERM", () => {
    void server.stop();
  });

  await server.start();
  console.log(`Lore API listening on :${port}`);
}
