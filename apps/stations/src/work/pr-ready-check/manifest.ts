import type { SweepStationModule } from "../lib/station.js";

/** Sweep that unparks implementation-loop await-pr nodes, checking if PR is green/blocked (specs/implementation-loop FR4). */
export const prReadyCheck: SweepStationModule = {
  manifest: {
    name: "pr-ready-check",
    description:
      "Resume implementation-loop runs whose PR is green and thread-clean (or blocked).",
    triggers: [{ kind: "cron", schedule: "*/2 * * * *" }, { kind: "http" }],
    requires: ["repoFor"],
  },
  run: async () => (await import("./pr-ready-check.js")).prReadyCheckJob(),
};
