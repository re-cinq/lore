import type { NodeStationModule } from "../lib/station.js";

// Classify one human PR comment into a follow-up action. Runtime is the pooled service, not a pod: despite untrusted human text reaching a model in the process holding merge authority + the GitHub App key, the call is schema-constrained to a 4-value enum with no tools/workspace, so a hostile comment can only steer WHICH follow-up starts — already true of the words a commenter writes. The pod paid ~19min of schedule/pull/clone/boot per fraction-of-a-cent Haiku call (527 pods, 164 pod-hours in one month) for isolation the enum already provided.
export const commentTriage: NodeStationModule = {
  manifest: {
    name: "comment-triage",
    description: "Classify one human PR comment into a follow-up action.",
    triggers: [
      {
        kind: "node",
        nodeType: "comment-triage",
        runtime: "service",
        outcomes: ["success", "failed"],
        timeoutMinutes: 5,
      },
    ],
  },
  run: async (input) =>
    (await import("./comment-triage.js")).runCommentTriageStation(input),
};
