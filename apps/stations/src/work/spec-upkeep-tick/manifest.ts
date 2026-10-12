import type { SweepStationModule } from "../lib/station.js";

/** The weekly spec upkeep's tick (specs/external-floor FR14). Where no floor is configured the Floor's spec-drift and spec-coverage-backfill lines still run on their own ticks, and this one starts nothing. */
export const specUpkeepTickStation: SweepStationModule = {
  manifest: {
    name: "spec-upkeep-tick",
    description:
      "Start one spec-upkeep run on the external floor per onboarded repository.",
    triggers: [
      { kind: "event", eventNames: ["cron.spec_upkeep.tick"] },
      { kind: "http" },
    ],
  },
  run: async (ctx) =>
    (await import("./run.js")).runSpecUpkeepTick(ctx.event?.params ?? {}),
};
