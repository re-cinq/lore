import type { SweepStationModule } from "../lib/station.js";

// Fans the weekly link backfill out per specification, replacing the per-repository fan-out for this one detector — the other three detectors stay whole-repo since none of them is the long unit this exists to break up.
export const backfillScan: SweepStationModule = {
  manifest: {
    name: "backfill-scan",
    description: "Start one link-backfill unit per specification.",
    triggers: [
      // Monday, after the week's merges have settled — the schedule the per-repo fan-out ran on, unchanged.
      { kind: "cron", schedule: "0 11 * * 1" },
      { kind: "http" },
    ],
    requires: ["repoFor"],
  },
  run: async (ctx) => (await import("./run.js")).runBackfillScan(ctx),
};
