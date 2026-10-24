import {
  reviewFeedback,
  reviewSubmittedFeedback,
} from "@re-cinq/lore-shared/review/code-review-decisions.js";
import type {
  PullReview,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { LORE_REVIEW_MARKER } from "../post-review/post-review.js";

export function parseReviewId(reviewIdText: string): number | null {
  return Number(reviewIdText) || null;
}

export function reviewBodyOf(
  reviews: PullReview[],
  reviewId: number | null,
): string {
  return reviews.find((review) => review.id === reviewId)?.body ?? "";
}

export function inlineCommentsOf(
  comments: ReviewComment[],
  reviewId: number | null,
): ReviewComment[] {
  return reviewId === null
    ? []
    : comments.filter((comment) => comment.review_id === reviewId);
}

export function feedbackOf(
  reviewBody: string,
  inlineComments: ReviewComment[],
): string {
  return reviewSubmittedFeedback(reviewBody, inlineComments);
}

/** What Lore's newest review said, its body and inline comments; empty when Lore has posted none. */
export function loreReviewFeedbackOf(
  reviews: PullReview[],
  comments: ReviewComment[],
): string {
  const newest = reviews
    .filter((review) => review.body.includes(LORE_REVIEW_MARKER))
    .sort((a, b) => a.id - b.id)
    .at(-1);

  return newest
    ? reviewFeedback(newest.body, inlineCommentsOf(comments, newest.id))
    : "";
}
