// Which round content a node's prompt is rendered with.
//
// A run that resumed a conversation already holds its own last answer, so restating
// it re-briefs the model on what it just said. A run that did NOT resume holds
// nothing, and a feedback-only turn would ask it to refine a draft it has never
// seen. The line carries both forms; this picks.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";

export interface RoundContentTask {
  description: string;
  args?: Record<string, unknown>;
}

/**
 * The description to render the node's prompt with.
 *
 * `conversation.id` is the whole signal: it is the id of the run being resumed, and
 * dispatch leaves it empty when there is nothing to resume — a first round, a retry,
 * or a thread whose only prior run never uploaded its state. Every one of those
 * needs the full composition, so no extra flag has to stay in sync with it.
 */
export function roundContent(
  task: RoundContentTask,
  conversation: LoreTaskSpec["conversation"] | undefined,
): string {
  if (!conversation?.id) {
    return task.description;
  }
  const feedback = task.args?.round_feedback;

  return typeof feedback === "string" && feedback.trim()
    ? feedback
    : task.description;
}
