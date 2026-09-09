// The comment-triage station: a cheap Haiku classification of one PR comment; the chosen action rides in LORE_NODE_RESULT extras.action, read by the Floor's node-terminal handler to start the review/address/answer follow-up (or nothing on ignore). Comment context arrives as station params (threaded from the triage line's args by nodeStationSpec).

import { classifyComment } from "@re-cinq/lore-shared/review/comment-triage.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

// A comment that could not be classified is a FAILED node, not an ignorable one — reporting success with action `ignore` (what a swallowed failure used to do) drops the comment while telling the walk it was handled.
function unclassified(err: Error): NodeResult {
  return {
    outcome: "failed",
    failureClass: "unknown",
    failureDetail: `comment triage could not classify: ${err.message}`,
  };
}

// The comment as the classifier reads it. Everything arrives as station params — strings threaded from the triage line's args — so each field is coerced here rather than trusted.
function commentToClassify(input: StationInput) {
  const p = input.params;

  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- params is z.record(z.string(), z.string()); zod does not guarantee this specific key was present in the wire JSON
    body: p.comment_body ?? "",
    isReply: Boolean(p.in_reply_to_id),
    prNumber: Number(p.pr_number) || 0,
  };
}

export async function runCommentTriageStation(
  input: StationInput,
): Promise<NodeResult> {
  let decision;

  try {
    decision = await classifyComment(commentToClassify(input));
  } catch (err) {
    return unclassified(err as Error);
  }

  return {
    outcome: "success",
    extras: {
      action: decision.action,
      "Lore-Triage": decision.reason.slice(0, 200),
    },
    usage: decision.usage,
  };
}
