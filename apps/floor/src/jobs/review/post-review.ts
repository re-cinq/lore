/**
 * Deterministic review poster. The `review` node emits structured
 * {@link ReviewOutput} findings (it no longer writes comment markdown itself);
 * this renders each finding as a {@link ConventionalComment} and posts one review
 * carrying the whole comments array, plus a scannable summary body.
 *
 * Two hazards it is built to survive, because both silently drop a real review:
 * - GitHub's review API is atomic — a single inline comment on a line outside
 *   the diff 422s the WHOLE review. Findings on files the PR does not touch are
 *   folded into the body instead of posted inline, and any residual post failure
 *   (an out-of-hunk line in a changed file) falls back to one top-level comment.
 * - An approval with nothing to flag emitted no findings block, so nothing was
 *   posted and the run looked silent. A bare `REVIEW_RESULT:APPROVED` now posts
 *   a visible "no issues" review.
 */

import { ConventionalComment } from "@re-cinq/lore-shared/review/conventional-comment.js";
import { buildReviewSummary } from "@re-cinq/lore-shared/review/review-summary.js";
import { parseReviewFindings } from "@re-cinq/lore-shared/review/review-findings.js";
import type {
  ReviewFinding,
  ReviewOutput,
} from "@re-cinq/lore-shared/review/review-findings.js";
import { parseReviewVerdict } from "@re-cinq/lore-assembly-lines";
import {
  isCommentable,
  type CommentablePositions,
} from "@re-cinq/lore-shared/review/diff-hunks.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The narrow PR surface the poster touches — a light double in tests. */
export interface ReviewPoster {
  createReview(number: number, input: CreateReviewInput): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  getDiff(number: number): Promise<string>;
}

/**
 * Split findings by whether their exact (path, line) is inside a diff hunk. Only
 * a line GitHub will accept can be an inline comment — one that is not (a line in
 * an unchanged region, or a file the PR does not touch) 422s the whole atomic
 * review — so it rides in the body instead. Line-level, not file-level: a finding
 * on a changed file but an unchanged line still cannot be inline.
 */
export function partitionByHunks(
  findings: ReviewFinding[],
  positions: CommentablePositions,
): { inline: ReviewFinding[]; overflow: ReviewFinding[] } {
  const inline: ReviewFinding[] = [];
  const overflow: ReviewFinding[] = [];

  for (const finding of findings) {
    const commentable = isCommentable(
      positions,
      finding.path,
      finding.line,
      finding.side,
    );

    (commentable ? inline : overflow).push(finding);
  }

  return { inline, overflow };
}

function renderComment(finding: ReviewFinding): string {
  return new ConventionalComment({
    label: finding.label,
    decoration: finding.decoration,
    subject: finding.subject,
    discussion: finding.discussion,
    suggestion: finding.suggestion,
  }).render();
}

function toReviewComment(finding: ReviewFinding) {
  return {
    path: finding.path,
    line: finding.line,
    ...(finding.side ? { side: finding.side } : {}),
    body: renderComment(finding),
  };
}

function renderOutOfDiff(finding: ReviewFinding): string {
  return `**\`${finding.path}:${finding.line}\`** — ${renderComment(finding)}`;
}

/** The review body: the standard summary, plus any findings on lines GitHub
 *  cannot inline (out-of-hunk lines, or files outside the diff). */
export function composeBody(
  output: ReviewOutput,
  overflow: ReviewFinding[],
): string {
  const summary = buildReviewSummary(output);

  if (overflow.length === 0) {
    return summary;
  }
  const notes = overflow.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n### Notes on lines outside changed hunks\n\n${notes}`;
}

/** Marks a review that fell back from an inline post — a flat comment with no
 *  inline annotations otherwise looks like an intentional body-only review. */
const FALLBACK_NOTE =
  "_Inline placement was rejected by GitHub, so this review is posted as a single comment._";

/** The whole review as one top-level comment — the never-drop fallback for when
 *  the inline post is rejected (e.g. an out-of-hunk line 422). */
function fallbackComment(output: ReviewOutput): string {
  const summary = `${FALLBACK_NOTE}\n\n${buildReviewSummary(output)}`;

  if (output.findings.length === 0) {
    return summary;
  }
  const all = output.findings.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n${all}`;
}

/** How the post was delivered. `fallback` means GitHub rejected the inline
 *  review and the whole review went out as one top-level comment — the caller
 *  audits it, because a silent downgrade is invisible at the PR. */
export type ReviewPostDelivery =
  { mode: "inline" } | { mode: "fallback"; error: string };

export async function postReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  positions: CommentablePositions,
): Promise<ReviewPostDelivery> {
  const { inline, overflow } = partitionByHunks(output.findings, positions);

  try {
    await pulls.createReview(prNumber, {
      event: "COMMENT",
      body: composeBody(output, overflow),
      comments: inline.map(toReviewComment),
    });

    return { mode: "inline" };
  } catch (err) {
    // The review post is atomic — one out-of-hunk line 422s all of it. Never
    // drop the review: deliver it whole as a single top-level comment.
    const error = (err as Error).message;

    console.warn(
      `[code-review] inline review rejected (${error}); posting as a top-level comment`,
    );
    await pulls.comment(prNumber, fallbackComment(output));

    return { mode: "fallback", error };
  }
}

/** A bare `REVIEW_RESULT:APPROVED` with no findings block is a legitimate "LGTM"
 *  — synthesize an empty approved review so the approval is visible, not silent. */
function approvedWithoutFindings(agentOutput: string): ReviewOutput | null {
  return parseReviewVerdict(agentOutput) === "success"
    ? { verdict: "approved", findings: [], summary: "No issues found." }
    : null;
}

/**
 * Parse the review node's raw output and post the review. No-op (returns null)
 * when the output carries neither a valid `REVIEW_FINDINGS` block nor a bare
 * approval verdict. `positions` are the diff's commentable lines, used to keep a
 * finding on an uninlineable line out of the inline comments array.
 */
export async function maybePostReview(
  pulls: ReviewPoster,
  prNumber: number,
  agentOutput: string,
  positions: CommentablePositions,
): Promise<ReviewPostDelivery | null> {
  const output =
    parseReviewFindings(agentOutput) ?? approvedWithoutFindings(agentOutput);

  if (!output) {
    return null;
  }

  return postReview(pulls, prNumber, output, positions);
}
