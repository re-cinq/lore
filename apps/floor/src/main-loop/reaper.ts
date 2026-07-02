/**
 * Crash-recovery for pipeline.events: a 60s tick resets rows stuck in `processing`
 * (the claimer died mid-handler) back to failed so they re-run. Pruning old terminal
 * rows is owned solely by the `cron.events_prune.tick` handler (hourly) — it used to
 * run here too, which was redundant double housekeeping.
 */

import { reapStuck } from "./store.js";

const VISIBILITY_TIMEOUT_SECONDS = 600; // a handler running >10min is presumed dead

export function startEventReaper(intervalMs = 60_000): NodeJS.Timeout {
  console.log("[events] reaper started");
  return setInterval(() => {
    reapStuck(VISIBILITY_TIMEOUT_SECONDS)
      .then((n) => {
        if (n > 0) console.log(`[events] reaped ${n} stuck processing event(s)`);
      })
      .catch((err) => console.error("[events] reaper failed:", err));
  }, intervalMs);
}
