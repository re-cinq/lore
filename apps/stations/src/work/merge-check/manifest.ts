import type { SweepStationModule } from "../lib/station.js";

/** Notice merged and closed PRs and settle implications (FR12 pending). */
export const mergeCheck: SweepStationModule = {
  manifest: {
    name: "merge-check",
    description: "Settle tasks whose PR merged or closed.",
    // Every minute, on the tick this service emits (specs/external-floor FR16).
    triggers: [
      { kind: "event", eventNames: ["cron.merge_check.tick"] },
      { kind: "http" },
    ],
    requires: ["repoFor"],
  },
  run: async () => (await import("./merge-check.js")).mergeCheckJob(),
};
