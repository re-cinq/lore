import type { SweepStationModule } from "../lib/station.js";

/** Sweep that unparks implementation-loop await-pr nodes, checking if PR is green/blocked (specs/implementation-loop FR4). */
export const prReadyCheck: SweepStationModule = {
  manifest: {
    name: "pr-ready-check",
    description:
      "Resume implementation-loop runs whose PR is green and thread-clean (or blocked).",
    // Every two minutes, on the tick this service emits (specs/external-floor FR16).
    triggers: [
      { kind: "event", eventNames: ["cron.pr_ready_check.tick"] },
      { kind: "http" },
    ],
    requires: ["repoFor"],
  },
  run: async () => (await import("./pr-ready-check.js")).prReadyCheckJob(),
};
