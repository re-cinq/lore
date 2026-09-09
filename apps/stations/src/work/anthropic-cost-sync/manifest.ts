import type { SweepStationModule } from "../lib/station.js";

// Imports the Anthropic daily cost report — a single scheduled data op that runs beside the data rather than in its own pod; the host supplies the port since this package is shared with a pod that has none.
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
