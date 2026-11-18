import type { SweepStationModule } from "../lib/station.js";

// The Azure counterpart of gcp-cost-sync, half an hour after it: Cost Management closes a day at UTC midnight and restates stragglers later, so one pull after the day settles suffices and the trailing window self-heals the rest. It writes the same pipeline.gcp_cost_daily rows, under provider azure.
export const azureCostSync: SweepStationModule = {
  manifest: {
    name: "azure-cost-sync",
    description:
      "Import the Azure daily cost report from Cost Management into the cloud cost table.",
    triggers: [{ kind: "cron", schedule: "30 8 * * *" }, { kind: "http" }],
    requires: ["gcpCost"],
  },
  run: async (ctx) =>
    (await import("./azure-cost-sync.js")).azureCostSyncJob(ctx.host.gcpCost()),
};
