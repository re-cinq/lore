// Deterministic review poster, ported from the Floor: renders ReviewOutput findings as ConventionalComments and posts one review, surviving an out-of-hunk inline comment 422ing the atomic review and a no-findings approval looking silent.

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

/** One visit of the post-review station: its identity keys the dedupe marker and signs every body. */
export interface ReviewVisit {
  visitId: string;
  iteration: number;
}

/** Per-visit identity stamped into every posted review; probing for it makes a redelivered visit a no-op. */
export function reviewVisitMarker({ visitId, iteration }: ReviewVisit): string {
  return `<!-- lore-review-run: ${visitId}/${iteration} -->`;
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

/** What the body calls the findings it renders itself: on an inline review only the ones GitHub would not take a comment on land here, but a review that stepped down carries ALL of them, and calling those "outside changed hunks" is simply false. */
const OUT_OF_HUNK_HEADING = "Notes on lines outside changed hunks";
const STEPPED_DOWN_HEADING = "Findings";

/** Says where the verdict went when GitHub would not take it as one. It is not a detail: a reader who sees "Approved" in a comment has no way to know whether anything is gating the merge, and the check is what does. */
const COMMENT_NOTE =
  "_GitHub does not accept an approving or blocking review from the account that opened this pull request, so this review is posted as a comment. Its verdict is published on the `lore/code-review` check._";

/** How far down the ladder a review had to go to reach the PR. `inline` is the whole review with its comments in the diff; `summary` keeps the APPROVE/REQUEST_CHANGES verdict but renders every finding in the body, for a line GitHub will not take a comment on; `comment` is a COMMENT-event review, the only kind GitHub accepts on a PR the reviewer authored; `fallback` is a plain issue comment, the floor that never drops a review. `deduped`: this visit's marker was already on the PR. */
export type ReviewPostDelivery =
  | { mode: "inline" }
  | { mode: "summary"; error: string }
  | { mode: "comment"; error: string }
  | { mode: "fallback"; error: string }
  | { mode: "deduped"; marker: string };

/** How a review reaches the PR: where inline comments may land, the visit that signs and dedupes it, and the model the disclosure names. */
export interface ReviewDelivery {
  positions: CommentablePositions;
  visit: ReviewVisit;
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
  return mode === "inline" ? { mode } : ({ mode, error } as ReviewPostDelivery);
}

/** The verdict with every finding in the body: what a review becomes when GitHub will not take one of its inline comments. */
async function postSummaryReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { visit, model }: ReviewDelivery,
): Promise<void> {
  await pulls.createReview(prNumber, {
    event: reviewEvent(output),
    body: signed(
      composeBody(output, output.findings, model, STEPPED_DOWN_HEADING),
      visit,
    ),
    comments: [],
  });
}

/** The review as a COMMENT — the one event GitHub accepts from the account that opened the PR, so a self-authored PR's review is still a review a reader can find, not a loose comment. */
async function postCommentReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { visit, model }: ReviewDelivery,
): Promise<void> {
  const body = composeBody(
    output,
    output.findings,
    model,
    STEPPED_DOWN_HEADING,
  );

  await pulls.createReview(prNumber, {
    event: "COMMENT",
    body: signed(`${COMMENT_NOTE}\n\n${body}`, visit),
    comments: [],
  });
}

async function postInlineReview(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { positions, visit, model }: ReviewDelivery,
): Promise<void> {
  const { inline, overflow } = partitionByHunks(output.findings, positions);

  await pulls.createReview(prNumber, {
    event: reviewEvent(output),
    body: signed(composeBody(output, overflow, model), visit),
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

function signed(body: string, visit: ReviewVisit): string {
  return `${body}\n\n${identityLine(visit)}\n\n${reviewVisitMarker(visit)}`;
}

function identityLine({ visitId }: ReviewVisit): string {
  return `_Posted by floor, visit ${visitId}._`;
}

/** The review body: the standard summary, plus any findings GitHub cannot inline. */
export function composeBody(
  output: ReviewOutput,
  written: ReviewFinding[],
  model?: string,
  heading: string = OUT_OF_HUNK_HEADING,
): string {
  const summary = buildReviewSummary(output, { model });

  if (written.length === 0) {
    return summary;
  }
  const notes = written.map(renderOutOfDiff).join("\n\n");

  return `${summary}\n\n### ${heading}\n\n${notes}`;
}

async function postFallback(
  pulls: ReviewPoster,
  prNumber: number,
  output: ReviewOutput,
  { visit, model, error }: ReviewDelivery & { error: string },
): Promise<ReviewPostDelivery> {
  console.warn(
    `[code-review] inline review rejected (${error}); posting as a top-level comment`,
  );
  await pulls.comment(prNumber, signed(fallbackComment(output, model), visit));

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

/** Parse the review node's raw output and post it; no-op (null) with neither a `REVIEW_FINDINGS` block nor a bare approval. The dedupe probe runs after the parse (so a no-op run skips the paginated reads) and right before the post. */
export async function maybePostReview(
  pulls: ReviewPoster,
  prNumber: number,
  agentOutput: string,
  delivery: ReviewDelivery,
): Promise<ReviewPostDelivery | null> {
  const marker = reviewVisitMarker(delivery.visit);
  const output =
    parseReviewFindings(agentOutput) ?? approvedWithoutFindings(agentOutput);

  if (!output) {
    return null;
  }

  if (await reviewAlreadyPosted(pulls, prNumber, marker)) {
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
