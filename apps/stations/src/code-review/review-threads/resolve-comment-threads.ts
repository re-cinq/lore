import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";

export interface ThreadResolver {
  listReviewThreads(prNumber: number): Promise<ReviewThread[]>;
  resolveReviewThread(threadId: string): Promise<void>;
}

// Best-effort on purpose: what settles the threads is already posted, so an unreadable or unresolvable thread is left open.
export async function resolveCommentThreads(
  resolver: ThreadResolver,
  prNumber: number,
  commentIds: readonly number[],
): Promise<void> {
  if (commentIds.length === 0) {
    return;
  }

  try {
    const threads = await resolver.listReviewThreads(prNumber);
    const threadIds = commentThreadIds(threads, commentIds);

    await Promise.all(
      threadIds.map((threadId) => resolver.resolveReviewThread(threadId)),
    );
  } catch (err) {
    console.warn(
      `[code-review] thread not resolved: ${(err as Error).message}`,
    );
  }
}

/** The open threads the comments sit in, each once: two comments of one thread resolve it once. */
function commentThreadIds(
  threads: readonly ReviewThread[],
  commentIds: readonly number[],
): string[] {
  const replied = commentIds.flatMap(
    (commentId) => findThreadForComment(threads, commentId) ?? [],
  );

  return [...new Set(replied.map((thread) => thread.id))];
}
