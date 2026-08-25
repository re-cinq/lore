import type { ReviewThread } from "./pull-requests-port.js";

/**
 * The thread containing the REST review-comment id, or null. The reply path
 * posts over REST and knows only `in_reply_to_id`; GraphQL thread nodes carry
 * each comment's `databaseId` (that same REST id), so this join is how a
 * posted reply finds the thread to resolve (specs/implementation-loop FR5).
 * A null databaseId never matches — 0 is not a real comment id — and an
 * already-resolved thread is skipped: there is nothing left to resolve, and
 * matching it would spend the mutation on a thread a human may have closed.
 */
export function findThreadForComment(
  threads: readonly ReviewThread[],
  restCommentId: number,
): ReviewThread | null {
  if (!restCommentId) {
    return null;
  }

  return (
    threads.find(
      (t) =>
        !t.isResolved && t.comments.some((c) => c.databaseId === restCommentId),
    ) ?? null
  );
}
