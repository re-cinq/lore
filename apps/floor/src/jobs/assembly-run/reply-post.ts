// Posting a code-review-refine node's reply into the PR thread it addresses: the node commits its fix but can't post to GitHub itself (no `gh` in the pod); it emits a fenced REVIEW_REPLY block, posted in-thread here — absent block or a throw is audited, never fatal.

import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { parseReviewReply } from "@re-cinq/lore-shared/review/review-reply.js";
import { writeAuditLog } from "../lib/audit.js";
import { projectFor } from "../../composition/project-boot.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type {
  IssueComment,
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";

// The narrow PR surface the reply post touches; the dedupe-probe reads are optional — a poster without them just skips the probe (fail open: a rare duplicate beats a dropped reply).
export interface ReplyPoster {
  replyToReviewComment(
    number: number,
    commentId: number,
    body: string,
  ): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  listComments?(number: number): Promise<ReviewComment[]>;
  listIssueComments?(number: number): Promise<IssueComment[]>;
  // Optional like the reads above — a poster without the thread methods just skips resolution (fail open; specs/implementation-loop FR5).
  listReviewThreads?(number: number): Promise<ReviewThread[]>;
  resolveReviewThread?(threadId: string): Promise<void>;
}

// `iteration` keys the per-run dedupe marker (mirrors ReviewPorts) so a revisited refine node still posts while a redelivery does not; unknown iteration skips marker+probe (fail open) rather than guessing `1`.
export interface ReplyPorts {
  poster?: ReplyPoster;
  audit?: AuditPort;
  iteration?: number;
}

// Mirrors ReviewPostOutcome: `no_reply` = no REVIEW_REPLY block; reply posting is a side effect and never overrides the node outcome (REVIEW_RESULT drives success/failed).
export type ReplyPostOutcome =
  "posted" | "already_posted" | "no_reply" | "post_failed" | "not_reply";

// Invisible per-run identity leading every posted reply, keyed per iteration; runs BEFORE the node-outcome CAS (spec 6-dark-factory FR6.11) so this marker's probe is what makes a redelivered terminal event a no-op (#1004).
function replyRunMarker(
  assemblyLineId: string,
  nodeId: string,
  iteration: number,
): string {
  return `<!-- lore-reply-run: ${assemblyLineId}/${nodeId}/${iteration} -->`;
}

type ThreadResolveAudit = (
  payload: Record<string, unknown>,
  resolved: boolean,
) => Promise<void>;

/** Looks up the thread the reply landed in, auditing (and swallowing) a lookup failure or an unmatched comment. */
async function findRepliedThread(
  listReviewThreads: NonNullable<ReplyPoster["listReviewThreads"]>,
  prNumber: number,
  inReplyTo: number,
  audit: ThreadResolveAudit,
): Promise<ReviewThread | null> {
  try {
    const thread = findThreadForComment(
      await listReviewThreads(prNumber),
      inReplyTo,
    );

    if (!thread) {
      await audit({ reason: "no_thread_for_comment" }, false);
    }

    return thread;
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
async function resolveRepliedThread(
  row: AssemblyRunRecord,
  pulls: ReplyPoster,
  { prNumber, inReplyTo }: { prNumber: number; inReplyTo: number },
  ports: ReplyPorts,
): Promise<void> {
  if (row.args.intent !== "address") {
    return;
  }

  const { listReviewThreads, resolveReviewThread } = pulls;

  if (!listReviewThreads || !resolveReviewThread) {
    return;
  }
  const audit: ThreadResolveAudit = (payload, resolved) =>
    writeAuditLog(
      {
        event_type: resolved
          ? "review_thread_resolved"
          : "review_thread_resolve_failed",
        repo: row.repo,
        payload: {
          pr_number: prNumber,
          assembly_run_id: row.id,
          in_reply_to_id: inReplyTo,
          ...payload,
        },
      },
      ports.audit,
    );
  const thread = await findRepliedThread(
    listReviewThreads,
    prNumber,
    inReplyTo,
    audit,
  );

  if (!thread) {
    return;
  }
  await resolveThreadSafely(resolveReviewThread, thread, audit);
}

/** Which PR a reply targets, or null when this node isn't a reply-shaped one at all. */
function replyTargetPrNumber(
  row: AssemblyRunRecord,
  node: RunGraphNode,
): number | null {
  if (node.prompt_ref !== "code-review-refine") {
    return null;
  }

  return Number(row.args.pr_number) || null;
}

async function auditUnparsedReply(
  row: AssemblyRunRecord,
  prNumber: number,
  output: string | undefined,
  ports: ReplyPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_reply_unparsed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        output_length: output?.length ?? 0,
      },
    },
    ports.audit,
  );
}

/** The comment this reply is addressed to (if any) and its per-run dedupe marker. */
function replyIdentity(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  ports: ReplyPorts,
): { inReplyTo: number; marker: string | undefined } {
  const inReplyTo =
    Number(row.args.in_reply_to_id) || Number(row.args.comment_id) || 0;
  const marker =
    ports.iteration === undefined
      ? undefined
      : replyRunMarker(row.id, node.id, ports.iteration);

  return { inReplyTo, marker };
}

interface DeliverReplyParams {
  row: AssemblyRunRecord;
  prNumber: number;
  inReplyTo: number;
  marker: string | undefined;
  body: string;
  ports: ReplyPorts;
}

/** Posts the reply (or skips it as a dedupe) and, when it landed in a thread, resolves that thread. */
async function deliverReply(
  params: DeliverReplyParams,
): Promise<ReplyPostOutcome> {
  const { row, prNumber, inReplyTo, marker, body, ports } = params;
  const pulls = ports.poster ?? (await projectFor(row.repo)).pulls;

  if (marker && (await replyAlreadyPosted(pulls, prNumber, marker))) {
    await auditDedupedReply(row, prNumber, marker, ports);

    return "already_posted";
  }
  // The marker LEADS the comment because the body is agent-authored — trailing it risks an opening prefix that platform-github's listIssueComments filter drops.
  const stamped = marker ? `${marker}\n\n${body}` : body;

  if (inReplyTo > 0) {
    await pulls.replyToReviewComment(prNumber, inReplyTo, stamped);
    await resolveRepliedThread(row, pulls, { prNumber, inReplyTo }, ports);

    return "posted";
  }
  await pulls.comment(prNumber, stamped);

  return "posted";
}

async function auditReplyPostFailed(
  row: AssemblyRunRecord,
  prNumber: number,
  err: Error,
  ports: ReplyPorts,
): Promise<void> {
  console.error("[code-review-refine] post reply failed:", err.message);
  await writeAuditLog(
    {
      event_type: "review_reply_post_failed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        error: err.message,
      },
    },
    ports.audit,
  );
}

export async function postReplyFromNode(
  row: AssemblyRunRecord,
  node: RunGraphNode,
  output?: string,
  ports: ReplyPorts = {},
): Promise<ReplyPostOutcome> {
  const prNumber = replyTargetPrNumber(row, node);

  if (prNumber === null) {
    return "not_reply";
  }
  const body = parseReviewReply(output ?? "");

  if (!body) {
    await auditUnparsedReply(row, prNumber, output, ports);

    return "no_reply";
  }
  const { inReplyTo, marker } = replyIdentity(row, node, ports);

  try {
    return await deliverReply({
      row,
      prNumber,
      inReplyTo,
      marker,
      body,
      ports,
    });
  } catch (err) {
    await auditReplyPostFailed(row, prNumber, err as Error, ports);

    return "post_failed";
  }
}

// Whether this run's reply already reached the PR (either delivery shape); best-effort like the review probe — a missing read surface or a throw reports "not posted" so the guard never drops a reply, at the cost of a rare duplicate.
async function replyAlreadyPosted(
  pulls: ReplyPoster,
  prNumber: number,
  marker: string,
): Promise<boolean> {
  if (!pulls.listComments || !pulls.listIssueComments) {
    return false;
  }

  try {
    const [threads, comments] = await Promise.all([
      pulls.listComments(prNumber),
      pulls.listIssueComments(prNumber),
    ]);

    return (
      threads.some((thread) => thread.body.includes(marker)) ||
      comments.some((comment) => comment.body.includes(marker))
    );
  } catch (err) {
    console.warn(
      `[code-review-refine] reply dedupe probe failed (${(err as Error).message}); posting anyway`,
    );

    return false;
  }
}

// The reply-side twin of `review_post_deduped` (#1004): this run's marker is already on the PR, so the reply post was skipped.
async function auditDedupedReply(
  row: AssemblyRunRecord,
  prNumber: number,
  marker: string,
  ports: ReplyPorts,
): Promise<void> {
  await writeAuditLog(
    {
      event_type: "review_reply_post_deduped",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_run_id: row.id,
        marker,
      },
    },
    ports.audit,
  );
}
