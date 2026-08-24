// The comment-triage station: a cheap Haiku classification of one human PR
// comment. The chosen action rides in LORE_NODE_RESULT extras.action; the Floor's
// node-terminal handler reads it and starts the review / address / answer
// follow-up (or nothing, on ignore). The comment context arrives as station
// params (threaded from the triage line's args by nodeStationSpec).

import { classifyComment } from "@re-cinq/lore-shared/review/comment-triage.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export async function runCommentTriageStation(
  input: StationInput,
): Promise<NodeResult> {
  const p = input.params;
  let decision;

  try {
    decision = await classifyComment({
      body: p.comment_body ?? "",
      isReply: Boolean(p.in_reply_to_id),
      prNumber: Number(p.pr_number) || 0,
    });
  } catch (err) {
    // A comment that could not be classified is a FAILED node, not an ignorable
    // comment. Reporting success with action `ignore` — which is what a swallowed
    // failure used to do — drops the comment and tells the walk it was handled.
    return {
      outcome: "failed",
      failureClass: "unknown",
      failureDetail: `comment triage could not classify: ${(err as Error).message}`,
    };
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
