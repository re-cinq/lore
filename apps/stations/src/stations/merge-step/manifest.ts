import type { NodeStationModule } from "../lib/station.js";

/**
 * One step of the merge line.
 *
 * A single node type parameterised by `job_ref`, the shape `detect` already
 * uses: nine steps that share a form and differ only in which piece of
 * post-merge work they do. One `NodeType` entry, one recipe, nine handlers.
 *
 * Runtime is the pooled service. Every step is a database write or a GitHub
 * call over data the platform produced itself — none of them clones a
 * workspace, executes anything untrusted, or needs a deadline of its own, which
 * is precisely the case the service form exists for.
 */
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
