// Lore's own reviews on a pull request: every one Lore posts is signed, which is how a reader tells them from a person's.
import type {
  PullReview,
  ReviewComment,
  ReviewThread,
} from "../../outbound/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "../../outbound/project/pulls/review-threads.js";
import { valueItem } from "../../outbound/floor/floor-items.js";
import type { Item } from "@re-cinq/floor-client";
import { reviewFeedback } from "./code-review-decisions.js";
import { CHANGES_SUGGESTED_HEADING } from "./review-summary.js";

/** How every review Lore posts is signed, whichever visit posted it. */
export const LORE_REVIEW_MARKER = "<!-- lore-review-run: ";

/** What Lore's newest review said, its body and inline comments; empty when Lore has posted none. */
export function loreReviewFeedbackOf(
  reviews: readonly PullReview[],
  comments: readonly ReviewComment[],
): string {
  const newest = newestLoreReview(reviews);

  return newest ? feedbackOfReview(newest, comments) : "";
}

function newestLoreReview(
  reviews: readonly PullReview[],
): PullReview | undefined {
  return reviews
    .filter((review) => review.body.includes(LORE_REVIEW_MARKER))
    .sort((a, b) => a.id - b.id)
    .at(-1);
}

function feedbackOfReview(
  review: PullReview,
  comments: readonly ReviewComment[],
): string {
  return reviewFeedback(
    review.body,
    comments.filter((comment) => comment.review_id === review.id),
  );
}

/** One finding of Lore's still open on the pull request: its thread, and the comment that opened it. */
export interface OpenLoreFinding {
  threadId: string;
  where: string;
  body: string;
}

/** Lore's findings whose threads nobody has resolved: what a re-check is asked to judge again, and what its approval settles. */
export function openLoreFindings(
  reviews: readonly PullReview[],
  comments: readonly ReviewComment[],
  threads: readonly ReviewThread[],
): OpenLoreFinding[] {
  const lore = new Set(
    reviews
      .filter((review) => review.body.includes(LORE_REVIEW_MARKER))
      .map(({ id }) => id),
  );

  return comments.flatMap((comment) => {
    const thread =
      comment.review_id != null && lore.has(comment.review_id)
        ? findThreadForComment(threads, comment.id)
        : null;

    return thread ? [findingOf(thread, comment)] : [];
  });
}

function findingOf(
  thread: ReviewThread,
  comment: ReviewComment,
): OpenLoreFinding {
  const where =
    comment.line === null ? comment.path : `${comment.path}:${comment.line}`;

  return { threadId: thread.id, where, body: comment.body };
}

/** The part of a re-check's brief that names Lore's findings still open; empty when none is. */
export function openFindingsBrief(
  findings: readonly OpenLoreFinding[],
): string {
  if (findings.length === 0) {
    return "";
  }
  const lines = findings.map(({ where, body }) => `- ${where}: ${body}`);

  return `\n\nLore's earlier findings still open on this pull request. Approve only when the code resolves every one of them; list each one it does not resolve as a finding again:\n${lines.join("\n")}`;
}

/** The reads Lore's open findings are gathered from. */
export interface OpenFindingsReads {
  listReviews(number: number): Promise<PullReview[]>;
  listComments(number: number): Promise<ReviewComment[]>;
  listReviewThreads(number: number): Promise<ReviewThread[]>;
}

/** What a re-check is handed of Lore's earlier review: its brief, and the threads its approval settles. */
export interface RecheckHandOff {
  brief: string;
  threadIds: string[];
}

/** Lore's findings still open, as threads, and, when Lore's newest review asked for changes, that review's findings, which a review GitHub would take no inline comment for keeps only in its body. Without them the re-check judges only the commits since the last verdict, and approves a rebase that fixed nothing. */
export function recheckHandOff(
  reviews: readonly PullReview[],
  comments: readonly ReviewComment[],
  threads: readonly ReviewThread[],
): RecheckHandOff {
  const findings = openLoreFindings(reviews, comments, threads);
  const newest = newestLoreReview(reviews);
  const asked = newest?.body.includes(CHANGES_SUGGESTED_HEADING)
    ? askedSection(feedbackOfReview(newest, comments))
    : "";

  return {
    brief: openFindingsBrief(findings) + asked,
    threadIds: findings.map(({ threadId }) => threadId),
  };
}

function askedSection(feedback: string): string {
  return `\n\nLore's last review asked for changes. Approve only when the code resolves every finding it made; list each one it does not resolve as a finding again:\n${feedback}`;
}

export async function readRecheckHandOff(
  pulls: OpenFindingsReads,
  prNumber: number,
): Promise<RecheckHandOff> {
  const [reviews, comments, threads] = await Promise.all([
    pulls.listReviews(prNumber),
    pulls.listComments(prNumber),
    pulls.listReviewThreads(prNumber),
  ]);

  return recheckHandOff(reviews, comments, threads);
}

/** The threads an approving re-check settles, named for the station that posts its verdict. */
export function openThreadsItem(
  threadIds: readonly string[],
): Record<string, Item> {
  return threadIds.length > 0
    ? { open_threads: valueItem(threadIds.join(",")) }
    : {};
}
