import type { SweepStationModule } from "../lib/station.js";

/**
 * Import the Anthropic daily cost report.
 *
 * A single data operation on a schedule, so it runs beside the data rather than
 * in a pod of its own. The host supplies the port; this package is shared with a
 * pod that has none.
 */
export const anthropicCostSync: SweepStationModule = {
  manifest: {
    name: "anthropic-cost-sync",
    description: "Import the Anthropic daily cost report.",
    triggers: [{ kind: "cron", schedule: "0 7 * * *" }, { kind: "http" }],
    requires: ["cost"],
  },
  run: async (ctx) =>
    (await import("./anthropic-cost-sync.js")).anthropicCostSyncJob(
      ctx.host.cost(),
    ),
};
