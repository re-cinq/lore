// Lore's own reviews on a pull request: every one Lore posts is signed, which is how a reader tells them from a person's.
import type {
  PullReview,
  ReviewComment,
} from "../../outbound/project/pulls/pull-requests-port.js";
import { reviewFeedback } from "./code-review-decisions.js";

/** How every review Lore posts is signed, whichever visit posted it. */
export const LORE_REVIEW_MARKER = "<!-- lore-review-run: ";

/** What Lore's newest review said, its body and inline comments; empty when Lore has posted none. */
export function loreReviewFeedbackOf(
  reviews: readonly PullReview[],
  comments: readonly ReviewComment[],
): string {
  const newest = reviews
    .filter((review) => review.body.includes(LORE_REVIEW_MARKER))
    .sort((a, b) => a.id - b.id)
    .at(-1);

  return newest
    ? reviewFeedback(
        newest.body,
        comments.filter((comment) => comment.review_id === newest.id),
      )
    : "";
}

/** The inline comments of every review Lore posted except the one signed `ownMarker`: what an approval settles, while the approving review's own comments are new. */
export function earlierLoreCommentIds(
  reviews: readonly PullReview[],
  comments: readonly ReviewComment[],
  ownMarker: string,
): number[] {
  const earlier = new Set(
    reviews
      .filter(
        ({ body }) =>
          body.includes(LORE_REVIEW_MARKER) && !body.includes(ownMarker),
      )
      .map(({ id }) => id),
  );

  return comments
    .filter(
      ({ review_id: reviewId }) => reviewId != null && earlier.has(reviewId),
    )
    .map(({ id }) => id);
}
