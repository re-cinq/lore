/**
 * Deterministic review poster. The `review` node emits structured
 * {@link ReviewOutput} findings (it no longer writes comment markdown itself);
 * this renders each finding as a {@link ConventionalComment} and posts one review
 * carrying the whole comments array, plus a scannable summary body. A malformed /
 * absent findings block posts nothing rather than failing the node.
 */

import { ConventionalComment } from "@re-cinq/lore-shared/review/conventional-comment.js";
import { buildReviewSummary } from "@re-cinq/lore-shared/review/review-summary.js";
import { parseReviewFindings } from "@re-cinq/lore-shared/review/review-findings.js";
import type { ReviewOutput } from "@re-cinq/lore-shared/review/review-findings.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The narrow PR surface the poster touches — a light double in tests. */
export interface ReviewPoster {
  createReview(number: number, input: CreateReviewInput): Promise<void>;
}

export async function postReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
): Promise<void> {
  const comments = output.findings.map((f) => ({
    path: f.path,
    line: f.line,
    ...(f.side ? { side: f.side } : {}),
    body: new ConventionalComment({
      label: f.label,
      decoration: f.decoration,
      subject: f.subject,
      discussion: f.discussion,
      suggestion: f.suggestion,
    }).render(),
  }));

  await pulls.createReview(prNumber, {
    event: "COMMENT",
    body: buildReviewSummary(output),
    comments,
  });
}

/**
 * Parse the review node's raw output and post the review. No-op (returns false)
 * when the output carries no valid `REVIEW_FINDINGS` block.
 */
export async function maybePostReview(
  pulls: ReviewPoster,
  prNumber: number,
  agentOutput: string,
): Promise<boolean> {
  const output = parseReviewFindings(agentOutput);

  if (!output) {
    return false;
  }
  await postReview(pulls, prNumber, output);

  return true;
}
