// Which round content a node's prompt is rendered with: a resumed conversation already holds its last answer (restating it re-briefs the model), a fresh one holds nothing and needs the full composition; the line carries both forms, this picks.

import type { LoreTaskSpec } from "@re-cinq/lore-shared";

export interface RoundContentTask {
  description: string;
  args?: Record<string, unknown>;
}

/** The description to render the node's prompt with. `conversation.id` is the whole signal — empty means nothing to resume (first round, retry, or unpersisted prior run), so no extra flag has to stay in sync with it. */
export function resolveRoundContent(
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
