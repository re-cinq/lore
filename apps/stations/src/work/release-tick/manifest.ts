import type { SweepStationModule } from "../lib/station.js";

/** The scheduled release's tick (specs/scheduled-releases): every 15 minutes it starts one release run per repository whose schedule is due, and syncs each public mirror's commits back (`mirror-sync-tick`). */
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
  run: async () => {
    const [releases, mirrors] = await Promise.all([
      import("./run.js").then(({ runReleaseTick }) => runReleaseTick()),
      import("../mirror-sync-tick/run.js").then(({ runMirrorSyncTick }) =>
        runMirrorSyncTick(),
      ),
    ]);

    return `${releases}; ${mirrors}`;
  },
};
