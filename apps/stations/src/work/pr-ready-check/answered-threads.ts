import type {
  ReviewThread,
  ReviewThreadComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { LoopRunSlice, PrReadyCheckDeps } from "./sweep-contract.js";

/** The App Lore's review posts as; only its threads are settled by a commit, a person's thread stays theirs to close. */
export const LORE_REVIEWER_LOGIN = "lore-reviewer";

interface Finding {
  threadId: string;
  path: string;
  commentId: number;
  commitSha: string;
}

interface Judged {
  prNumber: number;
  headSha: string;
}

/** An open, current thread of Lore's review on a file, with the comment and commit it was opened on; null for anything else. */
export function findingOf(thread: ReviewThread): Finding | null {
  const [opener] = thread.comments;

  if (!isCurrent(thread) || !thread.path || !openedByLore(opener)) {
    return null;
  }

  return {
    threadId: thread.id,
    path: thread.path,
    commentId: opener.databaseId,
    commitSha: opener.commitSha,
  };
}

function isCurrent(thread: ReviewThread): boolean {
  return !thread.isResolved && !thread.isOutdated;
}

function openedByLore(
  opener: ReviewThreadComment | undefined,
): opener is ReviewThreadComment & { databaseId: number; commitSha: string } {
  return (
    opener?.author === LORE_REVIEWER_LOGIN &&
    opener.databaseId !== null &&
    Boolean(opener.commitSha)
  );
}

/** The review threads as the verdict should read them: each of Lore's findings whose file a commit after it changed is answered on GitHub, then resolved, and counts as resolved. A thread that could not be settled stays open, so the run parks as before. */
export async function settleAnsweredThreads(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
  judged: Judged,
  threads: readonly ReviewThread[],
): Promise<ReviewThread[]> {
  return Promise.all(
    threads.map(async (thread) => {
      const finding = findingOf(thread);
      const settled =
        finding !== null && (await settleFinding(run, deps, judged, finding));

      return settled ? { ...thread, isResolved: true } : thread;
    }),
  );
}

async function settleFinding(
  { repo }: LoopRunSlice,
  deps: PrReadyCheckDeps,
  { prNumber, headSha }: Judged,
  finding: Finding,
): Promise<boolean> {
  const changed = await deps.filesChangedSince(
    repo,
    finding.commitSha,
    headSha,
  );

  if (!changed?.includes(finding.path)) {
    return false;
  }
  const answer = `Answered by ${headSha}, which changed ${finding.path} after this finding.`;

  await deps.replyToReviewComment(repo, prNumber, finding.commentId, answer);
  await deps.resolveReviewThread(repo, finding.threadId);

  return true;
}
