import type { SweepStationModule } from "../lib/station.js";

/** Reaps implementation-loop tasks stuck at `running` with no floor run (specs/implementation-loop FR18). */
export const loopReap: SweepStationModule = {
  manifest: {
    name: "loop-reap",
    description:
      "Fail implementation-loop tasks stuck running with no matching floor run, and requeue or block their ticket.",
    triggers: [
      { kind: "event", eventNames: ["cron.loop_reap.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runLoopReap(),
};
