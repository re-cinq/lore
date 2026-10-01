import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";

export interface ThreadResolver {
  listReviewThreads(prNumber: number): Promise<ReviewThread[]>;
  resolveReviewThread(threadId: string): Promise<void>;
}

export interface RepliedComment {
  prNumber: number;
  commentId: number;
}

// Best-effort on purpose: the reply already posted, so an unreadable or unresolvable thread is left open.
export async function resolveRepliedThread(
  resolver: ThreadResolver,
  replied: RepliedComment,
  intent: string,
): Promise<void> {
  if (intent !== "address") {
    return;
  }

  try {
    const threads = await resolver.listReviewThreads(replied.prNumber);
    const thread = findThreadForComment(threads, replied.commentId);

    await (thread && resolver.resolveReviewThread(thread.id));
  } catch (err) {
    console.warn(`[post-reply] thread not resolved: ${(err as Error).message}`);
  }
}
