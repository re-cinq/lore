import type { SweepStationModule } from "../lib/station.js";

/**
 * Unpark implementation-loop runs waiting at await-pr (implementation-loop
 * FR4): a pr_review node parks with no Agent CR and the reaper never times it
 * out, so this sweep is what comes along and reports the verdict — success
 * when the PR is green with zero unresolved review threads, changes_requested
 * when it is red or the threads outlived the address round-trip.
 *
 * Declares `repoFor` for merge-check's reason: it reads PRs through the code
 * host, and a sweep with no declared ports passes every host's check
 * vacuously.
 */
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
