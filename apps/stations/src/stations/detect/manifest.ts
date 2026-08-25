import type { NodeStationModule } from "../lib/station.js";

/**
 * Run one deterministic detection job against one repo.
 *
 * Runtime — Still a pod at its declared 30 minutes; the redesign into short units is
 *  specs/station-consolidation FR11 and lands with the detect work.
 */
export const detect: NodeStationModule = {
  manifest: {
    name: "detect",
    description: "Run one deterministic detection job against one repo.",
    triggers: [
      {
        kind: "node",
        nodeType: "detect",
        runtime: "pod",
        outcomes: ["success", "failed"],
        timeoutMinutes: 30,
      },
    ],
  },
  run: async (input, env) =>
    (await import("./detect.js")).runDetectStation(input, env),
};
