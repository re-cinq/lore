import type { ReviewThread } from "./pull-requests-port.js";

/** Thread containing the REST review-comment id, or null — joins REST's in_reply_to_id to GraphQL's databaseId so a posted reply finds its thread (specs/implementation-loop FR5); skips already-resolved threads. */
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
