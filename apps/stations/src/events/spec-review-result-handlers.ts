import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { SPEC_REVIEW_RESULT_EVENT } from "@re-cinq/lore-shared/review/spec-review.js";

export function specReviewResultHandlers(): Map<string, EventHandler> {
  return new Map<string, EventHandler>([
    [SPEC_REVIEW_RESULT_EVENT, onSpecReviewResult()],
  ]);
}

function onSpecReviewResult(): EventHandler {
  return async (_params) => {};
}
