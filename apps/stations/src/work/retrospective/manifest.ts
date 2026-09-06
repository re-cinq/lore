import type { NodeStationModule } from "../lib/station.js";

/** Write run's episode and mark line done (pooled service: one HTTP POST, best-effort). */
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
