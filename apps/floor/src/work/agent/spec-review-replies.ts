// The PR half of the spec writer's answer (specs/7-feature-planning, "Rework from the spec review"): every reviewed comment gets a reply on its thread, an addressed one has its thread resolved, and a whole review body — which sits in no thread — is answered as a comment on the PR. The pod holds no API token and no `gh`, so the Floor posts for it.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";
import {
  SPEC_REWORK_MARKER,
  specReviewFromArgs,
  type SpecReviewResult,
} from "@re-cinq/lore-shared/review/spec-review.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { ReplyPoster } from "../assembly-run/reply-post.js";

/** The PR surface the replies need: the reply post, the dedupe-probe reads, and the thread resolve — the reads and the resolve optional like on {@link ReplyPoster} (fail open). */
export type SpecReviewReplyPoster = Pick<
  ReplyPoster,
  | "replyToReviewComment"
  | "comment"
  | "listComments"
  | "listIssueComments"
  | "listReviewThreads"
  | "resolveReviewThread"
>;

/** The run a rework answers for: its plan and its spec PR. */
export interface ReviewTarget {
  run: AssemblyRunRecord;
  planId: string;
  prNumber: number;
}

type Reply = SpecReviewResult["replies"][number];

/** The reply the PR reader sees under each reviewed comment. */
export function replyText(reply: Reply): string {
  const lead =
    reply.action === "addressed"
      ? "Addressed in the latest push to this branch."
      : "Sent to the plan as a question for its people to settle; the spec keeps what the plan says until they answer.";

  return reply.note ? `${lead} ${reply.note}` : lead;
}

/** Invisible per-run, per-comment identity leading every reply, so a redelivered sink batch posts nothing twice. */
export function replyMarker(runId: string, commentId: number): string {
  return `${SPEC_REWORK_MARKER} ${runId}/${commentId} -->`;
}

interface ReplyCounts {
  replied: number;
  resolved: number;
}

/** One delivery's reply context: the PR, the run, the poster, and which ids are whole review bodies rather than threads. */
interface ReplyContext {
  target: ReviewTarget;
  pulls: SpecReviewReplyPoster;
  counts: ReplyCounts;
  reviewIds: Set<number>;
}

export async function postReplies(
  target: ReviewTarget,
  replies: readonly Reply[],
  pulls: SpecReviewReplyPoster,
): Promise<ReplyCounts> {
  const counts = { replied: 0, resolved: 0 };

  if (replies.length === 0) {
    return counts;
  }
  const posted = await postedBodies(pulls, target.prNumber);
  const context = { target, pulls, counts, reviewIds: reviewBodyIds(target) };

  for (const reply of replies) {
    const marker = replyMarker(target.run.id, reply.comment_id);
    const already = posted.some((body) => body.includes(marker));

    await (already ? healThread(context, reply) : postOne(context, reply));
  }

  return counts;
}

/** The ids the review carried as whole review bodies, which sit in no thread: answered as a comment on the PR, never resolved. */
function reviewBodyIds({ run }: ReviewTarget): Set<number> {
  const reviews = specReviewFromArgs(run.args)?.reviews ?? [];

  return new Set(reviews.map((body) => body.id));
}

// A redelivery after a resolve that failed: the reply is there, the thread may still be open; a review body sits in no thread.
async function healThread(context: ReplyContext, reply: Reply): Promise<void> {
  if (reply.action !== "addressed" || context.reviewIds.has(reply.comment_id)) {
    return;
  }
  context.counts.resolved += await resolveThreadOf(context, reply.comment_id);
}

// A failed post is logged and left uncounted: the other replies still go out, and a redelivery retries it because its marker never landed.
async function postOne(context: ReplyContext, reply: Reply): Promise<void> {
  const { target, counts, reviewIds } = context;
  const onReview = reviewIds.has(reply.comment_id);

  try {
    await (onReview
      ? commentOnReview(context, reply)
      : replyInThread(context, reply));
  } catch (err) {
    warnReply(
      target.prNumber,
      reply.comment_id,
      `reply failed: ${errorMessage(err)}`,
    );

    return;
  }
  counts.replied += 1;

  if (reply.action === "addressed" && !onReview) {
    counts.resolved += await resolveThreadOf(context, reply.comment_id);
  }
}

/** The answer to an inline comment, in its thread. */
function replyInThread(
  { target, pulls }: ReplyContext,
  reply: Reply,
): Promise<void> {
  const { run, prNumber } = target;

  return pulls.replyToReviewComment(
    prNumber,
    reply.comment_id,
    stamped(run.id, reply, replyText(reply)),
  );
}

/** The answer to a whole review body, which sits in no thread: a comment on the PR naming the review. */
function commentOnReview(
  { target, pulls }: ReplyContext,
  reply: Reply,
): Promise<void> {
  const { run, prNumber } = target;

  return pulls.comment(
    prNumber,
    stamped(
      run.id,
      reply,
      `On review ${reply.comment_id}: ${replyText(reply)}`,
    ),
  );
}

function stamped(runId: string, reply: Reply, text: string): string {
  return `${replyMarker(runId, reply.comment_id)}\n\n${text}`;
}

// Every body already on the PR, either delivery shape; a failed probe reads as "nothing posted" (fail open: a rare duplicate beats a dropped reply).
async function postedBodies(
  pulls: SpecReviewReplyPoster,
  prNumber: number,
): Promise<string[]> {
  try {
    const [threads, comments] = await Promise.all([
      pulls.listComments?.(prNumber) ?? [],
      pulls.listIssueComments?.(prNumber) ?? [],
    ]);

    return [...threads, ...comments].map((comment) => comment.body);
  } catch (err) {
    console.warn(
      `[spec-review-result] PR #${prNumber} dedupe probe failed (${errorMessage(err)}); posting anyway`,
    );

    return [];
  }
}

/** 1 when the thread the comment sits in is now resolved, 0 otherwise — a thread nobody could match, a poster without the thread methods, or a throw all leave it open and say so. */
async function resolveThreadOf(
  { pulls, target }: ReplyContext,
  commentId: number,
): Promise<number> {
  if (!pulls.listReviewThreads || !pulls.resolveReviewThread) {
    return 0;
  }

  try {
    return await resolveMatchingThread(pulls, target.prNumber, commentId);
  } catch (err) {
    warnReply(
      target.prNumber,
      commentId,
      `thread not resolved: ${errorMessage(err)}`,
    );

    return 0;
  }
}

// Called AS A METHOD: the adapter reaches its octokit through `this`, and the first delivery passed the function around unbound (plan b4b2026f, 2026-09-24: nine addressed threads left open).
async function resolveMatchingThread(
  pulls: SpecReviewReplyPoster,
  prNumber: number,
  commentId: number,
): Promise<number> {
  const threads = (await pulls.listReviewThreads?.(prNumber)) ?? [];
  const thread = findThreadForComment(threads, commentId);

  if (!thread) {
    return 0;
  }
  await pulls.resolveReviewThread?.(thread.id);

  return 1;
}

function warnReply(prNumber: number, commentId: number, what: string): void {
  console.warn(
    `[spec-review-result] PR #${prNumber} comment ${commentId}: ${what}`,
  );
}
