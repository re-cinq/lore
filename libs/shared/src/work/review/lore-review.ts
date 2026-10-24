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
