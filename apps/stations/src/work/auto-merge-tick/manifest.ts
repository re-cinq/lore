import type { SweepStationModule } from "../lib/station.js";

export const autoMergeTickStation: SweepStationModule = {
  manifest: {
    name: "auto-merge-tick",
    description:
      "Start one auto-merge run on the external floor per open pull request code review has passed, in each repository whose auto-merge loop is on.",
    triggers: [
      { kind: "event", eventNames: ["cron.auto_merge.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runAutoMergeTick(),
};
