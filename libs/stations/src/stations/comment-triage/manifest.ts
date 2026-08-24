import type { NodeStationModule } from "../../lib/station.js";
import { runCommentTriageStation } from "./comment-triage.js";

/**
 * Classify one human PR comment into a follow-up action.
 *
 * Runtime — A pod: it feeds UNTRUSTED human text to a model, which must not happen in the
 *  process that also holds merge authority and the GitHub App key.
 */
export const commentTriage: NodeStationModule = {
  manifest: {
    name: "comment-triage",
    description: "Classify one human PR comment into a follow-up action.",
    triggers: [
      {
        kind: "node",
        nodeType: "comment-triage",
        runtime: "pod",
        outcomes: ["success", "failed"],
        timeoutMinutes: 5,
      },
    ],
  },
  run: runCommentTriageStation,
};
