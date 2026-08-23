/**
 * The stations process: open the pool, load the shared approval config, serve.
 *
 * It runs work on demand and schedules nothing itself — the Floor still owns
 * WHEN a station runs; this owns WHAT it does.
 */

import { loadApprovalConfig } from "@re-cinq/lore-shared";
import { getPool, initPool } from "./kernel/db.js";
import { startServer } from "./delivery/server.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

async function main(): Promise<void> {
  initPool();
  // Module state read by approval-check; the Floor loads the same config for
  // its worker's gate.
  await loadApprovalConfig(getPool());

  const stopServer = await startServer(PORT);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[stations] ${signal} — shutting down`);
    await stopServer();
    await getPool().end();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[stations] fatal:", err);
  process.exit(1);
});
