import type { SweepStationModule } from "../lib/station.js";

/** The daily purge of blocked-reason rows whose PR merged or closed more than 30 days ago (specs/protected-branch-merge). */
export const prBlockedReasonsPrune: SweepStationModule = {
  manifest: {
    name: "pr-blocked-reasons-prune",
    description:
      "Delete blocked-reason rows whose PR closed more than 30 days ago.",
    triggers: [
      { kind: "event", eventNames: ["cron.pr_blocked_reasons_prune.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runPrBlockedReasonsPrune(),
};
