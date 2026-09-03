// Deterministic review poster: renders ReviewOutput findings as ConventionalComments and posts one review, surviving two hazards — an out-of-hunk inline comment 422ing the whole atomic review (falls back to a top-level comment) and a no-findings approval otherwise looking silent (posts a visible "no issues" review).

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
import type {
  CreateReviewInput,
  IssueComment,
  PRReviewEvent,
  PullReview,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** The narrow PR surface the poster touches; the two reads (dedupe probe) are optional and fail open — a rare duplicate beats a dropped review. */
export interface ReviewPoster {
  createReview(number: number, input: CreateReviewInput): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  getDiff(number: number): Promise<string>;
  listReviews?(number: number): Promise<PullReview[]>;
  listIssueComments?(number: number): Promise<IssueComment[]>;
}

/** Per-run identity stamped into every posted review, keyed per iteration; probing for it makes a redelivered terminal event's re-execution a no-op (post-then-transition, spec 6-dark-factory FR6.11, #870). */
export function reviewRunMarker(
  assemblyLineId: string,
  nodeId: string,
  iteration: number,
): string {
  return `<!-- lore-review-run: ${assemblyLineId}/${nodeId}/${iteration} -->`;
}

function withMarker(body: string, marker?: string): string {
  return marker ? `${body}\n\n${marker}` : body;
}

/** Split findings by whether (path, line) is inside a diff hunk — line-level, not file-level, since an unchanged line on a changed file still 422s an inline comment. */
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

/** Always APPROVE or REQUEST_CHANGES (never suggestion-only COMMENT) — the signal auto-merge's bot-approval gate reads. */
function reviewEvent(output: ReviewOutput): PRReviewEvent {
  return output.verdict === "approved" ? "APPROVE" : "REQUEST_CHANGES";
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

/** The review body: the standard summary, plus any findings GitHub cannot inline. */
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

/** Marks a fallback-posted review; must not start with a bot-noise prefix (`PR created:`/`Agent `/`Task ` in platform-github) or the dedupe probe's `listIssueComments` read would silently drop it. */
const FALLBACK_NOTE =
  "_Inline placement was rejected by GitHub, so this review is posted as a single comment._";

/** The whole review as one top-level comment — the never-drop fallback for a rejected inline post (e.g. an out-of-hunk line 422). */
function fallbackComment(output: ReviewOutput): string {
  const summary = `${FALLBACK_NOTE}\n\n${buildReviewSummary(output)}`;

  if (output.findings.length === 0) {
    return summary;
  }
  const all = output.findings.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n${all}`;
}

/** `fallback`: GitHub rejected the inline review, so the caller audits the downgrade to a top-level comment. `deduped`: this run's marker was already on the PR. */
export type ReviewPostDelivery =
  | { mode: "inline" }
  | { mode: "fallback"; error: string }
  | { mode: "deduped"; marker: string };

export async function postReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  positions: CommentablePositions,
  marker?: string,
): Promise<ReviewPostDelivery> {
  const { inline, overflow } = partitionByHunks(output.findings, positions);

  try {
    await pulls.createReview(prNumber, {
      event: reviewEvent(output),
      body: withMarker(composeBody(output, overflow), marker),
      comments: inline.map(toReviewComment),
    });

    return { mode: "inline" };
  } catch (err) {
    // Never drop the review: an atomic-post 422 falls back to one top-level comment.
    const error = (err as Error).message;

    console.warn(
      `[code-review] inline review rejected (${error}); posting as a top-level comment`,
    );
    await pulls.comment(prNumber, withMarker(fallbackComment(output), marker));

    return { mode: "fallback", error };
  }
}

/** A bare `REVIEW_RESULT:APPROVED` with no findings is a legitimate "LGTM" — synthesize an empty approved review so it's visible, not silent. */
function approvedWithoutFindings(agentOutput: string): ReviewOutput | null {
  return parseReviewVerdict(agentOutput) === "success"
    ? { verdict: "approved", findings: [], summary: "No issues found." }
    : null;
}

/** Parse the review node's raw output and post it; no-op (null) with neither a `REVIEW_FINDINGS` block nor a bare approval. With `marker`, the dedupe probe runs after the parse (so a no-op run skips the paginated reads) and right before the post. */
export async function maybePostReview(
  pulls: ReviewPoster,
  prNumber: number,
  agentOutput: string,
  positions: CommentablePositions,
  marker?: string,
): Promise<ReviewPostDelivery | null> {
  const output =
    parseReviewFindings(agentOutput) ?? approvedWithoutFindings(agentOutput);

  if (!output) {
    return null;
  }

  if (marker && (await reviewAlreadyPosted(pulls, prNumber, marker))) {
    return { mode: "deduped", marker };
  }

  return postReview(pulls, prNumber, output, positions, marker);
}

/** Whether this run's review already reached the PR, via either delivery shape; best-effort — a missing read surface or a throwing probe reports "not posted" so the guard never drops a review. */
export async function reviewAlreadyPosted(
  pulls: ReviewPoster,
  prNumber: number,
  marker: string,
): Promise<boolean> {
  if (!pulls.listReviews || !pulls.listIssueComments) {
    return false;
  }

  try {
    const [reviews, comments] = await Promise.all([
      pulls.listReviews(prNumber),
      pulls.listIssueComments(prNumber),
    ]);

    return (
      reviews.some((review) => review.body.includes(marker)) ||
      comments.some((comment) => comment.body.includes(marker))
    );
  } catch (err) {
    console.warn(
      `[code-review] dedupe probe failed (${(err as Error).message}); posting anyway`,
    );

    return false;
  }
}
