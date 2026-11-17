import type { SweepStationModule } from "../lib/station.js";

/** The client pack's catch-up (specs/client-packs FR-003): every few minutes lore-api reads the pack repo's head again, so a push whose webhook was dropped still reaches the install. */
export const packSyncTickStation: SweepStationModule = {
  manifest: {
    name: "pack-sync-tick",
    description:
      "Apply the client's pack repository again when its head moved without a webhook reaching Lore.",
    triggers: [
      { kind: "event", eventNames: ["cron.pack_sync.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runPackSyncTick(),
};
