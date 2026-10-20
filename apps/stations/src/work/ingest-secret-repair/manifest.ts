import type { SweepStationModule } from "../lib/station.js";

/** Started by hand only: it writes a secret into every onboarded repository, so nothing schedules it. */
export const ingestSecretRepairStation: SweepStationModule = {
  manifest: {
    name: "ingest-secret-repair",
    description:
      "Write the ingest secret and URL lore-api accepts into every onboarded repository again.",
    triggers: [{ kind: "http" }],
  },
  run: async () => (await import("./run.js")).runIngestSecretRepair(),
};
