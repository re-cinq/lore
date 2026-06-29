/**
 * Layer-1 cron listener. The in-process scheduler no longer runs jobs — each tick
 * just INSERTs a `cron.<name>.tick` event (idempotent per minute slot) and the
 * loop dispatches the real handler. Carve-out: only light/operational jobs are
 * registered here; heavy batch jobs stay as Kubernetes CronJobs (ADR-019).
 */

import { registerJob } from "../scheduling/scheduler.js";
import { insertEvent } from "../main-loop/store.js";
import { cronDedupeKey } from "../main-loop/dedupe.js";

/** Register a scheduled job that only emits its tick event (the loop runs the work). */
export function registerCronEmitter(name: string, cron: string): void {
  registerJob(name, cron, async () => {
    await insertEvent({
      eventName: `cron.${name}.tick`,
      source: "cron",
      dedupeKey: cronDedupeKey(name, new Date()),
    });
    return `emitted cron.${name}.tick`;
  });
}
