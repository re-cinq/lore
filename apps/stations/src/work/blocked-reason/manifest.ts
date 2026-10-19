import type { SweepStationModule } from "../lib/station.js";

/** Why each Lore PR is not merging yet (specs/protected-branch-merge); the work lives in `src/blocked-reason`. */
export const blockedReason: SweepStationModule = {
  manifest: {
    name: "blocked-reason",
    description:
      "Record, audit and comment why a Lore PR is not merging yet, whenever that changes.",
    triggers: [
      {
        kind: "event",
        eventNames: [
          "github.pull_request.opened",
          "github.pull_request.synchronize",
          "github.pull_request.ready_for_review",
          "github.pull_request.reopened",
          "github.pull_request.closed",
          "github.pull_request_review.submitted",
          "github.check_suite.completed",
          "github.push",
        ],
      },
    ],
  },
  run: async (ctx) => {
    const [{ runBlockedReason }, { productionDeps }] = await Promise.all([
      import("../../blocked-reason/station.js"),
      import("../../blocked-reason/deps.js"),
    ]);

    return runBlockedReason(
      { name: ctx.event?.name ?? "", params: ctx.event?.params ?? {} },
      productionDeps(),
    );
  },
};
