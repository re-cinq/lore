import type { SweepStationModule } from "../lib/station.js";

const TWELVE_HOURS_SECONDS = 43_200;

/** The nightly Utopia backfill (specs/utopia-graph-mirror FR7.7). One run walks every repo one at a time, each call allowed half an hour, so its delivery is held for a night rather than the bus's ten minutes. */
export const utopiaBackfillTickStation: SweepStationModule = {
  manifest: {
    name: "utopia-backfill-tick",
    description:
      "Mirror every onboarded repository's specs and ADRs into Utopia again, one repository at a time.",
    triggers: [
      {
        kind: "event",
        eventNames: ["cron.utopia_backfill.tick"],
        visibilityTimeoutSeconds: TWELVE_HOURS_SECONDS,
      },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runUtopiaBackfillTick(),
};
