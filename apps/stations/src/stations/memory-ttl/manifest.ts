import type { SweepStationModule } from "../lib/station.js";

/** Delete memories whose TTL has passed. */
export const memoryTtl: SweepStationModule = {
  manifest: {
    name: "memory-ttl",
    description: "Delete memories whose TTL has passed.",
    triggers: [{ kind: "cron", schedule: "0 * * * *" }, { kind: "http" }],
    requires: ["memoryLifecycle"],
  },
  run: async (ctx) =>
    (await import("./memory-ttl.js")).memoryTtlJob(ctx.host.memoryLifecycle()),
};
