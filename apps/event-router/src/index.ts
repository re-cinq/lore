/**
 * The event-router process: open the pool and serve the front door. It produces
 * events and nothing else — no drain loop, no job handlers, no Agent CR dispatch
 * (ADR-044), and since 2026-08-25 no Kubernetes watch either: that moved to
 * cluster-agent, which is the process that may hold a cluster client.
 */

import { initPool, getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { startServer } from "./delivery/server.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

async function main(): Promise<void> {
  initPool();

  const stopServer = await startServer(PORT);

  // One owner for the lifecycle: the server registers no handler of its own, so
  // a shutdown that stops serving but never exits cannot happen here.
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
