import type { NodeStationModule } from "../../lib/station.js";
import { runGateStation } from "./gate.js";

/**
 * Evaluate a deterministic condition node.
 *
 * Runtime — Referenced by no blueprint today; kept only until the node type is retired.
 */
export const gate: NodeStationModule = {
  manifest: {
    name: "gate",
    description: "Evaluate a deterministic condition node.",
    triggers: [
      {
        kind: "node",
        nodeType: "gate",
        runtime: "pod",
        outcomes: ["success", "failed"],
        timeoutMinutes: 5,
      },
    ],
  },
  run: runGateStation,
};
