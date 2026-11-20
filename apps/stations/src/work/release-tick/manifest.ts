import type { SweepStationModule } from "../lib/station.js";

/** The scheduled release's tick (specs/scheduled-releases): every 15 minutes it starts one release run per repository whose schedule is due. */
export const releaseTickStation: SweepStationModule = {
  manifest: {
    name: "release-tick",
    description:
      "Start one release run on the external floor per repository whose release schedule is due.",
    triggers: [
      { kind: "event", eventNames: ["cron.release.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runReleaseTick(),
};
