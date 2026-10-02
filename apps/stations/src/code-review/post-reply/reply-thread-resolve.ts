import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";

export interface ThreadResolver {
  listReviewThreads(prNumber: number): Promise<ReviewThread[]>;
  resolveReviewThread(threadId: string): Promise<void>;
}

// Best-effort on purpose: the replies already posted, so an unreadable or unresolvable thread is left open.
export async function resolveRepliedThreads(
  resolver: ThreadResolver,
  prNumber: number,
  commentIds: readonly number[],
): Promise<void> {
  if (commentIds.length === 0) {
    return;
  }

  try {
    const threads = await resolver.listReviewThreads(prNumber);
    const replied = commentIds.flatMap(
      (commentId) => findThreadForComment(threads, commentId) ?? [],
    );
    const threadIds = [...new Set(replied.map((thread) => thread.id))];

    await Promise.all(
      threadIds.map((threadId) => resolver.resolveReviewThread(threadId)),
    );
  } catch (err) {
    console.warn(`[post-reply] thread not resolved: ${(err as Error).message}`);
  }
}
