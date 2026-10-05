import type { SweepStationModule } from "../lib/station.js";

/** The spec-task executor's tick: every ready task of a plan becomes an implementation-loop run on the external floor (specs/external-floor FR15). The Floor only emits the tick. */
export const specTaskTickStation: SweepStationModule = {
  manifest: {
    name: "spec-task-tick",
    description:
      "Start an implementation-loop run on the external floor for each ready spec-task.",
    triggers: [
      { kind: "event", eventNames: ["cron.spec_task_executor.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runSpecTaskTick(),
};
