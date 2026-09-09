import type { SweepStationModule } from "../lib/station.js";

// Imports the GCP daily billing report from the Cloud Billing BigQuery export — daily like the Anthropic sync, an hour after it: the export closes days at UTC midnight and restates stragglers later, so one pull after the day settles suffices and the trailing window self-heals the rest.
export const gcpCostSync: SweepStationModule = {
  manifest: {
    name: "gcp-cost-sync",
    description:
      "Import the GCP daily billing report from the Cloud Billing BigQuery export.",
    triggers: [{ kind: "cron", schedule: "0 8 * * *" }, { kind: "http" }],
    requires: ["gcpCost"],
  },
  run: async (ctx) =>
    (await import("./gcp-cost-sync.js")).gcpCostSyncJob(ctx.host.gcpCost()),
};
