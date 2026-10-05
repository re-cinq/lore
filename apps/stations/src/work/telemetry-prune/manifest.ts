import type { SweepStationModule } from "../lib/station.js";

/** The daily 14-day reap of the two high-volume telemetry tables, agent run events and pod log chunks (specs/external-floor FR16). */
export const telemetryPrune: SweepStationModule = {
  manifest: {
    name: "telemetry-prune",
    description:
      "Prune agent run events and pod log chunks older than 14 days.",
    triggers: [
      { kind: "event", eventNames: ["cron.telemetry_prune.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runTelemetryPrune(),
};
