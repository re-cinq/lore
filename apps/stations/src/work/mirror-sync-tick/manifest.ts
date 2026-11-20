import type { SweepStationModule } from "../lib/station.js";

/** Brings each public mirror's commits back to its private repository's main (specs/public-mirror): it keeps one pull request open per repository whose public main holds commits the private main lacks. It has no event of its own: two stations may not share an event name, so the release tick's station runs it on the same 15 minutes (`release-tick/manifest.ts`). */
export const mirrorSyncTickStation: SweepStationModule = {
  manifest: {
    name: "mirror-sync-tick",
    description:
      "Open or update the pull request that merges each public mirror's main into its private repository's main.",
    triggers: [{ kind: "http" }],
  },
  run: async () => (await import("./run.js")).runMirrorSyncTick(),
};
