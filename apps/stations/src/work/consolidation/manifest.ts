import type { SweepStationModule } from "../lib/station.js";

// Turns the week's raw facts into a few patterns per repository. A model call beside the data, so it runs here rather than in a pod of its own; it was the last scheduled job that ran from the old Floor's image and did real work.
export const consolidationStation: SweepStationModule = {
  manifest: {
    name: "consolidation",
    description:
      "Group the week's facts per repository and store the patterns a model finds in them.",
    triggers: [{ kind: "cron", schedule: "30 5 * * *" }, { kind: "http" }],
    requires: ["memoryLifecycle"],
  },
  run: async (ctx) =>
    (await import("./consolidation.js")).consolidation(
      ctx.host.memoryLifecycle(),
    ),
};
