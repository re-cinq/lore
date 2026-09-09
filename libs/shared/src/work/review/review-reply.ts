/** Structured output contract for the code-review-refine `reply` node: the agent emits a fenced ` ```REVIEW_REPLY ` block (no `gh`/shell token in-pod), the Floor posts it via PullRequestsPort; absent/empty block yields `null`. */

const REPLY_BLOCK = /```REVIEW_REPLY\s*\n([\s\S]*?)```/;

export function parseReviewReply(output: string): string | null {
  const match = output.match(REPLY_BLOCK);

  if (!match) {
    return null;
  }
  const body = match[1].trim();

  return body.length > 0 ? body : null;
}
