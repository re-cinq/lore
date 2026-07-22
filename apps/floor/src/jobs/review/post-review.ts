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
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The narrow PR surface the poster touches — a light double in tests. */
export interface ReviewPoster {
  createReview(number: number, input: CreateReviewInput): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  listFiles(number: number): Promise<string[]>;
}

/**
 * Split findings by whether their file is in the PR diff. A finding on a file
 * the PR does not change can never be an inline comment — GitHub 422s the whole
 * atomic review over it — so it rides in the body instead.
 */
export function partitionByDiff(
  findings: ReviewFinding[],
  changedPaths: Set<string>,
): { inline: ReviewFinding[]; overflow: ReviewFinding[] } {
  const inline: ReviewFinding[] = [];
  const overflow: ReviewFinding[] = [];

  for (const finding of findings) {
    (changedPaths.has(finding.path) ? inline : overflow).push(finding);
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

/** The review body: the standard summary, plus any out-of-diff findings that
 *  could not be posted as inline comments. */
export function composeBody(
  output: ReviewOutput,
  overflow: ReviewFinding[],
): string {
  const summary = buildReviewSummary(output);

  if (overflow.length === 0) {
    return summary;
  }
  const notes = overflow.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n### Notes on files outside this diff\n\n${notes}`;
}

/** The whole review as one top-level comment — the never-drop fallback for when
 *  the inline post is rejected (e.g. an out-of-hunk line 422). */
function fallbackComment(output: ReviewOutput): string {
  const summary = buildReviewSummary(output);

  if (output.findings.length === 0) {
    return summary;
  }
  const all = output.findings.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n${all}`;
}

export async function postReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  changedPaths: Set<string>,
): Promise<void> {
  const { inline, overflow } = partitionByDiff(output.findings, changedPaths);

  try {
    await pulls.createReview(prNumber, {
      event: "COMMENT",
      body: composeBody(output, overflow),
      comments: inline.map(toReviewComment),
    });
  } catch (err) {
    // The review post is atomic — one out-of-hunk line 422s all of it. Never
    // drop the review: deliver it whole as a single top-level comment.
    console.warn(
      `[code-review] inline review rejected (${(err as Error).message}); posting as a top-level comment`,
    );
    await pulls.comment(prNumber, fallbackComment(output));
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
 * Parse the review node's raw output and post the review. No-op (returns false)
 * when the output carries neither a valid `REVIEW_FINDINGS` block nor a bare
 * approval verdict. `changedPaths` is the PR's changed-file set, used to keep an
 * out-of-diff finding out of the inline comments array.
 */
export async function maybePostReview(
  pulls: ReviewPoster,
  prNumber: number,
  agentOutput: string,
  changedPaths: Set<string>,
): Promise<boolean> {
  const output =
    parseReviewFindings(agentOutput) ?? approvedWithoutFindings(agentOutput);

  if (!output) {
    return false;
  }
  await postReview(pulls, prNumber, output, changedPaths);

  return true;
}
