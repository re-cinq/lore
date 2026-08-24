import type { SweepStationModule } from "../../lib/station.js";
import { memoryTtlJob } from "./memory-ttl.js";

/**
 * Delete memories whose TTL has passed.
 *
 * A single data operation on a schedule, so it runs beside the data rather than
 * in a pod of its own. The host supplies the port; this package is shared with a
 * pod that has none.
 */
export const memoryTtl: SweepStationModule = {
  manifest: {
    name: "memory-ttl",
    description: "Delete memories whose TTL has passed.",
    triggers: [{ kind: "cron", schedule: "0 * * * *" }, { kind: "http" }],
    requires: ["memoryLifecycle"],
  },
  run: (ctx) => memoryTtlJob(ctx.host.memoryLifecycle()),
};
