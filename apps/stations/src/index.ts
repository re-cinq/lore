/**
 * The stations process: open the pool, load the shared approval config, serve.
 *
 * It schedules nothing itself — the Floor still owns WHEN a station runs — but
 * it now DRAINS as well as serving: a node whose station runs here is published
 * by the walk onto the bus, and without a drainer it would be claimed by nobody.
 */

import { loadApprovalConfig } from "@re-cinq/lore-shared";
import { getPool, initPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { startServer } from "./delivery/server.js";
import { startStationDrain } from "./drain/loop-boot.js";
import { deliveries } from "./kernel/queues.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

async function main(): Promise<void> {
  initPool();
  // Module state read by approval-check; the Floor loads the same config for
  // its worker's gate.
  await loadApprovalConfig(getPool());

  // Before the server: a published node with nobody claiming it sits open until
  // the reaper times it out, and `merge_step` has no pod to fall back to.
  const drain = await startStationDrain({
    subscribe: (subscriber, subs) => deliveries().subscribe(subscriber, subs),
    claim: (subscriber, limit, exclude) =>
      deliveries().claim(subscriber, limit, exclude),
    markDone: (id) => deliveries().markDone(id),
    markFailed: (id, error, backoff) =>
      deliveries().markFailed(id, error, backoff),
    markDead: (id, error) => deliveries().markDead(id, error),
  });

  const stopServer = await startServer(PORT);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[stations] ${signal} — shutting down`);
    clearInterval(drain);
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
