/** Layer-1 cron listener: each tick just INSERTs an idempotent `cron.<name>.tick` event for the loop to dispatch, not run jobs directly — heavy batch jobs stay as Kubernetes CronJobs (ADR-019 carve-out). */

import { registerJob } from "../main-loop/scheduling/scheduler.js";
import { insertEvent } from "../main-loop/store.js";
import { cronDedupeKey } from "@re-cinq/lore-shared/project/events/dedupe.js";

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
