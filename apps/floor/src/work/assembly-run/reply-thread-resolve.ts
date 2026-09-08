// Resolving the review thread a reply just landed in, best-effort (specs/implementation-loop FR5): only on `address` intent — an `answer` leaves the human's thread open on purpose — joining the REST reply's comment id to GraphQL's databaseId via findThreadForComment; never fails the post that already succeeded.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";
import { writeAuditLog } from "../../outbound/audit.js";
import type { ReplyPoster, ReplyPorts } from "./reply-post.js";

type ThreadResolveAudit = (
  payload: Record<string, unknown>,
  resolved: boolean,
) => Promise<void>;

/** Looks up the thread the reply landed in, auditing (and swallowing) a lookup failure or an unmatched comment. */
async function findRepliedThread(
  listReviewThreads: NonNullable<ReplyPoster["listReviewThreads"]>,
  target: { prNumber: number; inReplyTo: number },
  audit: ThreadResolveAudit,
): Promise<ReviewThread | null> {
  const threads = await listThreadsSafely(
    listReviewThreads,
    target.prNumber,
    audit,
  );

  if (threads === null) {
    return null;
  }
  const thread = findThreadForComment(threads, target.inReplyTo);

  if (!thread) {
    await audit({ reason: "no_thread_for_comment" }, false);
  }

  return thread;
}

/** Null when the listing itself failed — audited and swallowed, since threads we cannot read are no reason to fail a reply that already posted. */
async function listThreadsSafely(
  listReviewThreads: NonNullable<ReplyPoster["listReviewThreads"]>,
  prNumber: number,
  audit: ThreadResolveAudit,
): Promise<ReviewThread[] | null> {
  try {
    return await listReviewThreads(prNumber);
  } catch (err) {
    await audit(
      { reason: "list_failed", error: (err as Error).message },
      false,
    );

    return null;
  }
}

/** Resolves the thread, auditing success or a swallowed resolve failure. */
async function resolveThreadSafely(
  resolveReviewThread: NonNullable<ReplyPoster["resolveReviewThread"]>,
  thread: ReviewThread,
  audit: ThreadResolveAudit,
): Promise<void> {
  try {
    await resolveReviewThread(thread.id);
    await audit({ thread_id: thread.id }, true);
  } catch (err) {
    await audit(
      {
        reason: "resolve_failed",
        thread_id: thread.id,
        error: (err as Error).message,
      },
      false,
    );
  }
}

// Resolve the thread a reply just landed in, best-effort (FR5): only on `address` intent (an `answer` leaves the human's thread open on purpose), joining the REST reply's comment id to GraphQL's databaseId via findThreadForComment; never fails the post that already succeeded.
/** Records both halves of the attempt — resolved and failed-to-resolve — under the same key set, so an unresolved thread is visible as a decision rather than as silence. */
function threadResolveAudit(
  row: AssemblyRunRecord,
  target: { prNumber: number; inReplyTo: number },
  ports: ReplyPorts,
): ThreadResolveAudit {
  return (payload, resolved) =>
    writeAuditLog(
      {
        event_type: threadResolveEvent(resolved),
        repo: row.repo,
        payload: { ...threadAuditKeys(row, target), ...payload },
      },
      ports.audit,
    );
}

function threadResolveEvent(resolved: boolean): string {
  return resolved ? "review_thread_resolved" : "review_thread_resolve_failed";
}

/** The keys both halves of the attempt share, so a resolve and a failure to resolve read as the same decision from two sides. */
function threadAuditKeys(
  row: AssemblyRunRecord,
  target: { prNumber: number; inReplyTo: number },
): Record<string, unknown> {
  return {
    pr_number: target.prNumber,
    assembly_run_id: row.id,
    in_reply_to_id: target.inReplyTo,
  };
}

export async function resolveRepliedThread(
  row: AssemblyRunRecord,
  pulls: ReplyPoster,
  target: { prNumber: number; inReplyTo: number },
  ports: ReplyPorts,
): Promise<void> {
  const { listReviewThreads, resolveReviewThread } = pulls;

  if (
    row.args.intent !== "address" ||
    !listReviewThreads ||
    !resolveReviewThread
  ) {
    return;
  }

  await resolveThreadForReply(
    { listReviewThreads, resolveReviewThread },
    target,
    threadResolveAudit(row, target, ports),
  );
}

/** Finds the thread the reply landed in and resolves it; a thread nobody could match is left open rather than treated as an error. */
async function resolveThreadForReply(
  threads: {
    listReviewThreads: NonNullable<ReplyPoster["listReviewThreads"]>;
    resolveReviewThread: NonNullable<ReplyPoster["resolveReviewThread"]>;
  },
  target: { prNumber: number; inReplyTo: number },
  audit: ThreadResolveAudit,
): Promise<void> {
  const thread = await findRepliedThread(
    threads.listReviewThreads,
    target,
    audit,
  );

  if (!thread) {
    return;
  }

  await resolveThreadSafely(threads.resolveReviewThread, thread, audit);
}
