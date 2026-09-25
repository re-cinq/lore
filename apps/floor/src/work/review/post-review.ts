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

/** Marks a fallback-posted review; must not start with a bot-noise prefix (`PR created:`/`Agent `/`Task ` in platform-github) or the dedupe probe's `listIssueComments` read would silently drop it. */
const FALLBACK_NOTE =
  "_Inline placement was rejected by GitHub, so this review is posted as a single comment._";

/** Says where the verdict went when GitHub would not take it as one. It is not a detail: a reader who sees "Approved" in a comment has no way to know whether anything is gating the merge, and the check is what does. */
const COMMENT_NOTE =
  "_GitHub does not accept an approving or blocking review from the account that opened this pull request, so this review is posted as a comment. Its verdict is published on the `lore/code-review` check._";

/** How far down the ladder a review had to go to reach the PR. `inline` is the whole review with its comments in the diff; `summary` keeps the APPROVE/REQUEST_CHANGES verdict but renders every finding in the body, for a line GitHub will not take a comment on; `comment` is a COMMENT-event review, the only kind GitHub accepts on a PR the reviewer authored; `fallback` is a plain issue comment, the floor that never drops a review. `deduped`: this run's marker was already on the PR. */
export type ReviewPostDelivery =
  | { mode: "inline" }
  | { mode: "summary"; error: string }
  | { mode: "comment"; error: string }
  | { mode: "fallback"; error: string }
  | { mode: "deduped"; marker: string };

/** How a review reaches the PR: where inline comments may land, the per-run marker that dedupes it, and the model the disclosure names. */
export interface ReviewDelivery {
  positions: CommentablePositions;
  marker?: string;
  model?: string;
}

/** Posts the review, giving up as little as GitHub forces at each step. Two different refusals used to land in the same place: ONE finding on a line outside the diff 422d the atomic post and downgraded the whole verdict to a comment, and a PR the review App itself authored is refused outright, which is every implementation-loop PR. So the ladder drops the inline comments first and the formal verdict only last. */
export async function postReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  delivery: ReviewDelivery,
): Promise<ReviewPostDelivery> {
  const rungs: Array<[ReviewPostDelivery["mode"], () => Promise<void>]> = [
    ["inline", () => postInlineReview(pulls, prNumber, output, delivery)],
    ["summary", () => postSummaryReview(pulls, prNumber, output, delivery)],
    ["comment", () => postCommentReview(pulls, prNumber, output, delivery)],
  ];
  const reached = await climb(rungs);

  // Never drop the review: with every review shape refused, one plain comment still carries it.
  return reached.mode === undefined
    ? postFallback(pulls, prNumber, output, {
        ...delivery,
        error: reached.refusal,
      })
    : deliveryOf(reached.mode, reached.refusal);
}

/** Runs each rung until one is accepted, carrying the last refusal down as the reason the review had to step down. */
async function climb(
  rungs: Array<[ReviewPostDelivery["mode"], () => Promise<void>]>,
): Promise<{ mode?: ReviewPostDelivery["mode"]; refusal: string }> {
  let refusal = "";

  for (const [mode, post] of rungs) {
    try {
      await post();

      return { mode, refusal };
    } catch (err) {
      refusal = (err as Error).message;
    }
  }

  return { refusal };
}

function deliveryOf(
  mode: ReviewPostDelivery["mode"],
  error: string,
): ReviewPostDelivery {
  return mode === "inline"
    ? { mode }
    : ({ mode, error } as ReviewPostDelivery);
}

/** The verdict with every finding in the body: what a review becomes when GitHub will not take one of its inline comments. */
async function postSummaryReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { marker, model }: ReviewDelivery,
): Promise<void> {
  await pulls.createReview(prNumber, {
    event: reviewEvent(output),
    body: withMarker(composeBody(output, output.findings, model), marker),
    comments: [],
  });
}

/** The review as a COMMENT — the one event GitHub accepts from the account that opened the PR, so a self-authored PR's review is still a review a reader can find, not a loose comment. */
async function postCommentReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { marker, model }: ReviewDelivery,
): Promise<void> {
  const body = composeBody(output, output.findings, model);

  await pulls.createReview(prNumber, {
    event: "COMMENT",
    body: withMarker(`${COMMENT_NOTE}\n\n${body}`, marker),
    comments: [],
  });
}

async function postInlineReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { positions, marker, model }: ReviewDelivery,
): Promise<void> {
  const { inline, overflow } = partitionByHunks(output.findings, positions);

  await pulls.createReview(prNumber, {
    event: reviewEvent(output),
    body: withMarker(composeBody(output, overflow, model), marker),
    comments: inline.map(toReviewComment),
  });
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

function withMarker(body: string, marker?: string): string {
  return marker ? `${body}\n\n${marker}` : body;
}

/** The review body: the standard summary, plus any findings GitHub cannot inline. */
export function composeBody(
  output: ReviewOutput,
  overflow: ReviewFinding[],
  model?: string,
): string {
  const summary = buildReviewSummary(output, { model });

  if (overflow.length === 0) {
    return summary;
  }
  const notes = overflow.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n### Notes on lines outside changed hunks\n\n${notes}`;
}

async function postFallback(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { marker, model, error }: ReviewDelivery & { error: string },
): Promise<ReviewPostDelivery> {
  console.warn(
    `[code-review] inline review rejected (${error}); posting as a top-level comment`,
  );
  await pulls.comment(
    prNumber,
    withMarker(fallbackComment(output, model), marker),
  );

  return { mode: "fallback", error };
}

/** The whole review as one top-level comment — the never-drop fallback for a rejected inline post (e.g. an out-of-hunk line 422). */
function fallbackComment(output: ReviewOutput, model?: string): string {
  const summary = `${FALLBACK_NOTE}\n\n${buildReviewSummary(output, { model })}`;
  const { findings } = output;

  if (findings.length === 0) {
    return summary;
  }
  const all = findings.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n${all}`;
}

function renderOutOfDiff(finding: ReviewFinding): string {
  return `**\`${finding.path}:${finding.line}\`** — ${renderComment(finding)}`;
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

/** Parse the review node's raw output and post it; no-op (null) with neither a `REVIEW_FINDINGS` block nor a bare approval. With `marker`, the dedupe probe runs after the parse (so a no-op run skips the paginated reads) and right before the post. */
export async function maybePostReview(
  pulls: ReviewPoster,
  prNumber: number,
  agentOutput: string,
  delivery: ReviewDelivery,
): Promise<ReviewPostDelivery | null> {
  const { marker } = delivery;
  const output =
    parseReviewFindings(agentOutput) ?? approvedWithoutFindings(agentOutput);

  if (!output) {
    return null;
  }

  if (marker && (await reviewAlreadyPosted(pulls, prNumber, marker))) {
    return { mode: "deduped", marker };
  }

  return postReview(pulls, prNumber, output, delivery);
}

/** A bare `REVIEW_RESULT:APPROVED` with no findings is a legitimate "LGTM" — synthesize an empty approved review so it's visible, not silent. */
function approvedWithoutFindings(agentOutput: string): ReviewOutput | null {
  return parseReviewVerdict(agentOutput) === "success"
    ? { verdict: "approved", findings: [], summary: "No issues found." }
    : null;
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
    return await markerOnPr(pulls, prNumber, marker);
  } catch (err) {
    console.warn(
      `[code-review] dedupe probe failed (${(err as Error).message}); posting anyway`,
    );

    return false;
  }
}

async function markerOnPr(
  pulls: ReviewPoster,
  prNumber: number,
  marker: string,
): Promise<boolean> {
  const [reviews, comments] = await Promise.all([
    pulls.listReviews!(prNumber),
    pulls.listIssueComments!(prNumber),
  ]);

  return (
    reviews.some((review) => review.body.includes(marker)) ||
    comments.some((comment) => comment.body.includes(marker))
  );
}
