import type { SweepStationModule } from "../lib/station.js";

/**
 * Fan the weekly link backfill out per specification.
 *
 * It replaces the per-REPOSITORY fan-out for this one detector. The other three
 * detectors stay whole-repo: two touch no model at all and the third reaches for
 * one only when a spec is absent from the graph, so none of them is the long
 * unit this exists to break up.
 */
export const backfillScan: SweepStationModule = {
  manifest: {
    name: "backfill-scan",
    description: "Start one link-backfill unit per specification.",
    triggers: [
      // Monday, after the week's merges have settled — the schedule the
      // per-repo fan-out ran on, unchanged.
      { kind: "cron", schedule: "0 11 * * 1" },
      { kind: "http" },
    ],
    requires: ["repoFor"],
  },
  run: async (ctx) => (await import("./run.js")).runBackfillScan(ctx),
};
