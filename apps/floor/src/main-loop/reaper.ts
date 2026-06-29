/**
 * Crash-recovery + housekeeping for pipeline.events. Mirrors the lease-reaper: a
 * 60s tick resets rows stuck in `processing` (the claimer died mid-handler) back
 * to failed so they re-run, and prunes old terminal rows to keep the index small.
 */

import { reapStuck, pruneHandled } from "./store.js";

const VISIBILITY_TIMEOUT_SECONDS = 600; // a handler running >10min is presumed dead
const PRUNE_AFTER_DAYS = 7;

export function startEventReaper(intervalMs = 60_000): NodeJS.Timeout {
  console.log("[events] reaper started");
  return setInterval(() => {
    reapStuck(VISIBILITY_TIMEOUT_SECONDS)
      .then((n) => {
        if (n > 0) console.log(`[events] reaped ${n} stuck processing event(s)`);
      })
      .catch((err) => console.error("[events] reaper failed:", err));
    pruneHandled(PRUNE_AFTER_DAYS).catch((err) => console.error("[events] prune failed:", err));
  }, intervalMs);
}
