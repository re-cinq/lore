import type { NodeStationModule } from "../lib/station.js";

/** One step of the merge line (parameterised by job_ref). */
export const mergeStep: NodeStationModule = {
  manifest: {
    name: "merge-step",
    description: "Run one step of the merge line.",
    triggers: [
      {
        kind: "node",
        nodeType: "merge_step",
        runtime: "service",
        outcomes: ["success", "failed"],
        timeoutMinutes: 5,
      },
    ],
  },
  run: async (input) => (await import("./run.js")).runMergeStepNode(input),
};
