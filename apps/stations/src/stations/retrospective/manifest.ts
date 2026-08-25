import type { NodeStationModule } from "../lib/station.js";

/**
 * Write the run's episode and mark the line done.
 *
 * Runtime — Pooled: one HTTP POST, best-effort, over data the platform itself produced.
 *  A pod per node for that is the waste the service form exists to remove.
 */
export const retrospective: NodeStationModule = {
  manifest: {
    name: "retrospective",
    description: "Write the run's episode and mark the line done.",
    triggers: [
      {
        kind: "node",
        nodeType: "retrospective",
        runtime: "service",
        outcomes: ["success", "failed"],
        timeoutMinutes: 10,
      },
    ],
  },
  run: async (input) =>
    (await import("./retrospective.js")).runRetrospectiveStation(input),
};
