import type { ReviewComment } from "./project/pulls/pull-requests-port.js";

/**
 * Human-readable description for the implementation task that addresses review
 * feedback. Replaces dumping the raw runner log into the task description.
 */
export function buildReviewFixDescription(opts: {
  prNumber: number | null;
  iteration: number;
}): string {
  const round = opts.iteration > 0 ? ` (round ${opts.iteration})` : "";
  return opts.prNumber
    ? `Address review feedback on PR #${opts.prNumber}${round}`
    : `Address review feedback${round}`;
}

/** Render PR review comments as a `- file:line — body` bullet list for the agent prompt. */
export function formatReviewFeedback(comments: ReviewComment[]): string {
  return comments
    .map((c) => {
      const location = c.line != null ? `${c.path}:${c.line}` : c.path;
      return `- ${location} — ${c.body.trim()}`;
    })
    .join("\n");
}
