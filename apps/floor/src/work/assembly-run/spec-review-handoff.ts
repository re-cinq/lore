// The spec PR's review, carried from the run's args into the writer's prompt when a person asks for the rework (specs/7-feature-planning, "Rework from the spec review"): an optional appended block, like the round hand-off, since the same write recipe runs the first draft with no review to answer.

import {
  renderSpecReview,
  type SpecReview,
} from "@re-cinq/lore-shared/review/spec-review.js";

/** Append the open review so the writer answers each item by its id; no review, prompt untouched. */
export function withSpecReview(
  prompt: string,
  review: SpecReview | null,
): string {
  if (!review) {
    return prompt;
  }

  return `${prompt}\n\n${renderSpecReview(review)}\n`;
}
