/**
 * The structured output contract for the code-review-refine `reply` node. Like
 * the review node, the agent does NOT post to GitHub itself (the pod has no
 * `gh` and no shell token) — it emits a fenced ` ```REVIEW_REPLY ` block whose
 * body is the markdown reply, and the Floor posts it in-thread through the
 * PullRequestsPort (App token). Absent or empty block yields `null`, so a
 * formatting slip posts nothing rather than crashing the node.
 */

const REPLY_BLOCK = /```REVIEW_REPLY\s*\n([\s\S]*?)```/;

export function parseReviewReply(output: string): string | null {
  const match = output.match(REPLY_BLOCK);

  if (!match) {
    return null;
  }
  const body = match[1].trim();

  return body.length > 0 ? body : null;
}
