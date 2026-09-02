import type { NodeStationModule } from "../lib/station.js";

/**
 * Classify one human PR comment into a follow-up action.
 *
 * Runtime — the pooled service. This ran in a pod on the argument that
 * untrusted human text must not reach a model inside the process holding merge
 * authority and the GitHub App key — but the call is a single completion whose
 * output is schema-constrained to the four-value action enum, with no tools and
 * no workspace: the only thing a hostile comment can steer is WHICH follow-up
 * starts, and a commenter already controls that by writing the words. The pod
 * bought ~19 minutes of schedule/pull/clone/boot ceremony per
 * fraction-of-a-cent Haiku call (527 pods, 164 pod-hours in one month) and no
 * isolation the enum had not already provided.
 */
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
