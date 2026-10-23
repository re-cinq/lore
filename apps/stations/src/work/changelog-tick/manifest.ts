import { triggerParams, type SweepStationModule } from "../lib/station.js";

/** The weekly changelog's tick (specs/repo-changelog): Mondays for the week that just ended, or by hand with `weeks` to backfill. */
export const changelogTickStation: SweepStationModule = {
  manifest: {
    name: "changelog-tick",
    description:
      "Start one weekly-changelog run on the external floor per repository and finished week without a changelog.",
    triggers: [
      { kind: "event", eventNames: ["cron.changelog.tick"] },
      { kind: "http" },
    ],
  },
  run: async (ctx) =>
    (await import("./run.js")).runChangelogTick(triggerParams(ctx)),
};
