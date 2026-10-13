import type { SweepStationModule } from "../lib/station.js";

/** The hourly housekeeping of the event bus (specs/external-floor FR16): prunes handled deliveries, names events nobody subscribes to and handlers that gave up, and ages out agent run events and transcripts. */
export const busPrune: SweepStationModule = {
  manifest: {
    name: "bus-prune",
    description:
      "Prune handled event deliveries and old agent telemetry; report orphaned events and dead letters.",
    triggers: [
      { kind: "event", eventNames: ["cron.events_prune.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runBusPrune(),
};
