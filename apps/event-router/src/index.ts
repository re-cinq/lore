/** Event-router process: pool + front door (ADR-044); Kubernetes watch moved to cluster-agent. */

import { initPool, getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { startServer } from "./delivery/server.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

async function main(): Promise<void> {
  initPool();

  const stopServer = await startServer(PORT);

  // One lifecycle owner: server has no handler, so stopServer → pool.end() → exit(0).
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[event-router] ${signal} — shutting down`);
    await stopServer();
    await getPool().end();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[event-router] fatal:", err);
  process.exit(1);
});
