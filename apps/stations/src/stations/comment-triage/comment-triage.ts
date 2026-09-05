// The comment-triage station: a cheap Haiku classification of one PR comment; the chosen action rides in LORE_NODE_RESULT extras.action, read by the Floor's node-terminal handler to start the review/address/answer follow-up (or nothing on ignore). Comment context arrives as station params (threaded from the triage line's args by nodeStationSpec).

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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- params is z.record(z.string()); zod does not guarantee this specific key was present in the wire JSON
      body: p.comment_body ?? "",
      isReply: Boolean(p.in_reply_to_id),
      prNumber: Number(p.pr_number) || 0,
    });
  } catch (err) {
    // A comment that could not be classified is a FAILED node, not an ignorable one — reporting success with action `ignore` (what a swallowed failure used to do) drops the comment while telling the walk it was handled.
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
