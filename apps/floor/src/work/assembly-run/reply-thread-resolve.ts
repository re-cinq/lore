// Resolving the review thread a reply just landed in, best-effort (specs/implementation-loop FR5): only on `address` intent — an `answer` leaves the human's thread open on purpose — joining the REST reply's comment id to GraphQL's databaseId via findThreadForComment; never fails the post that already succeeded.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";
import { writeAuditLog } from "../../outbound/audit.js";
import type { ReplyPoster, ReplyPorts } from "./reply-post.js";

/** Both halves of the attempt, named rather than selected by a flag: an unresolved thread is a decision, not silence. */
interface ThreadResolveAudit {
  resolved(payload: Record<string, unknown>): Promise<void>;
  failed(payload: Record<string, unknown>): Promise<void>;
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
    await audit.failed({ reason: "no_thread_for_comment" });
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
    await audit.failed({
      reason: "list_failed",
      error: (err as Error).message,
    });

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
    await audit.resolved({ thread_id: thread.id });
  } catch (err) {
    await audit.failed({
      reason: "resolve_failed",
      thread_id: thread.id,
      error: (err as Error).message,
    });
  }
}

// Resolve the thread a reply just landed in, best-effort (FR5): only on `address` intent (an `answer` leaves the human's thread open on purpose), joining the REST reply's comment id to GraphQL's databaseId via findThreadForComment; never fails the post that already succeeded.
/** Records both halves of the attempt — resolved and failed-to-resolve — under the same key set, so an unresolved thread is visible as a decision rather than as silence. */
function threadResolveAudit(
  row: AssemblyRunRecord,
  target: { prNumber: number; inReplyTo: number },
  ports: ReplyPorts,
): ThreadResolveAudit {
  const write = (event_type: string, payload: Record<string, unknown>) =>
    writeAuditLog(
      {
        event_type,
        repo: row.repo,
        payload: { ...threadAuditKeys(row, target), ...payload },
      },
      ports.audit,
    );

  return {
    resolved: (payload) => write("review_thread_resolved", payload),
    failed: (payload) => write("review_thread_resolve_failed", payload),
  };
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
