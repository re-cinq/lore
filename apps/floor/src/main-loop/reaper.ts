/**
 * Crash-recovery for the bus: a 60s tick returns deliveries stuck in `processing`
 * (the claimer died mid-handler) so they re-run. Pruning old terminal rows is
 * owned solely by the `cron.events_prune.tick` handler (hourly) — it used to run
 * here too, which was redundant double housekeeping.
 *
 * The 600s global ceiling is gone (ADR-044 delivery amendment): each delivery
 * carries the budget its own subscriber declared, so a handler is presumed dead
 * at the time its work was given rather than at a number that fitted the
 * shortest one. Under the global ceiling a longer handler was re-queued WHILE
 * STILL RUNNING and executed concurrently with itself until its attempts ran out.
 */

import { reapStuck } from "./store.js";

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
