import type { SweepStationModule } from "../lib/station.js";

/** The daily digest's tick, taken from the bus where the external floor walks the digest (specs/daily-digest FR14). The Floor's own handler for the same event stands down under the same condition, so one engine posts a channel's digest, never both. */
export const digestTickStation: SweepStationModule = {
  manifest: {
    name: "digest-tick",
    description:
      "Start one daily-digest run on the external floor per Slack channel that is due.",
    triggers: [
      { kind: "event", eventNames: ["cron.daily_digest.tick"] },
      { kind: "http" },
    ],
  },
  run: async (ctx) =>
    (await import("./run.js")).runDigestTick(ctx.event?.params ?? {}),
};
