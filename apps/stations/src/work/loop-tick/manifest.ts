import type { SweepStationModule } from "../lib/station.js";

/** The implementation loop's backlog tick, taken from the bus where the external floor walks the loop (specs/external-floor FR13). The Floor's own handler for the same event stands down under the same condition, so one engine picks a repository's next ticket, never both. */
export const loopTickStation: SweepStationModule = {
  manifest: {
    name: "loop-tick",
    description:
      "Pick each enabled repository's next backlog ticket and start its implementation-loop run on the external floor.",
    triggers: [
      { kind: "event", eventNames: ["cron.implementation_loop.tick"] },
      { kind: "http" },
    ],
  },
  run: async (ctx) =>
    (await import("./run.js")).runLoopTick(ctx.event?.params ?? {}),
};
