import { reviewSubmittedFeedback } from "@re-cinq/lore-shared/review/code-review-decisions.js";
import type {
  PullReview,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

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
