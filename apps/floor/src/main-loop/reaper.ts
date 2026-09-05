/** Crash-recovery for the bus: a 60s tick re-runs deliveries stuck in `processing`; per-delivery budgets replaced the global ceiling that could re-queue a handler while it was still running (ADR-044). */

import { reapStuck } from "../kernel/event-store.js";

export function startEventReaper(intervalMs = 60_000): NodeJS.Timeout {
  console.log("[events] reaper started");

  return setInterval(() => {
    reapStuck()
      .then((n) => {
        if (n > 0) {
          console.log(`[events] reaped ${n} stuck delivery(ies)`);
        }
      })
      .catch((err) => console.error("[events] reaper failed:", err));
  }, intervalMs);
}
