// The spec writer's answer to the spec review (specs/7-feature-planning, "Rework from the spec review"), delivered where each half belongs: a question it could not settle goes to the plan for its people, and every reviewed comment gets a reply on the PR — the pod holds no API token and no `gh`, so the Floor carries both. Never merged into the run's args (artifact-args OWNED_ELSEWHERE).

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { findThreadForComment } from "@re-cinq/lore-shared/project/pulls/review-threads.js";
import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import {
  SPEC_REVIEW_REOPEN_ARG,
  SPEC_REVIEW_RESULT_EVENT,
  specReviewFromArgs,
  specReviewResultSchema,
  type SpecReviewResult,
} from "@re-cinq/lore-shared/review/spec-review.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { PlanWriter } from "../../domain/plan-writer.js";
import type { ReplyPoster } from "../assembly-run/reply-post.js";
import type { AgentFileEvent } from "./agent-events.js";

/** Who the plan's people see asking. */
export const SPEC_WRITER_ACTOR = "spec-writer";

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

export interface SpecReviewResultDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "listForTask" | "mergeArgs">;
  plans: Pick<PlanWriter, "addQuestions">;
  /** The PR surface of the run's repo. */
  pullsFor(repo: string): Promise<SpecReviewReplyPoster>;
}

/** What the DELIVERY did: `invalid` = the writer's file is not an answer, `skipped` = not this handler's, or no run to answer for. */
export type SpecReviewDelivery =
  | {
      outcome: "delivered";
      questions: number;
      replied: number;
      resolved: number;
    }
  | { outcome: "invalid"; error: string }
  | { outcome: "skipped"; error: string };

/** The run a rework answers for: its plan and its spec PR. */
interface ReviewTarget {
  run: AssemblyRunRecord;
  planId: string;
  prNumber: number;
}

type PlanQuestion = SpecReviewResult["plan_questions"][number];
type Reply = SpecReviewResult["replies"][number];

/** The writer's answer from the sink: questions to the plan, replies to the PR, and the reopen flag on the run when the plan now has something to settle. Never throws on a bad file; a failed reply or resolve is logged and counted, never fatal. */
export async function deliverSpecReviewResult(
  fileEvent: AgentFileEvent,
  deps: SpecReviewResultDeps,
): Promise<SpecReviewDelivery> {
  const skipped = skipReason(fileEvent);

  if (skipped) {
    return skipped;
  }
  const target = reviewTargetOf(
    await openRunOfTask(fileEvent.taskId, deps.assemblyRuns),
  );

  if (!target) {
    return { outcome: "skipped", error: "no open run with a plan and a PR" };
  }
  const result = parseResult(fileEvent.content ?? "");

  return result.ok
    ? deliver(target, result.value, deps)
    : invalidAnswer(fileEvent.taskId, result.error);
}

function invalidAnswer(taskId: string, error: string): SpecReviewDelivery {
  console.warn(`[spec-review-result] task ${taskId}: ${error}`);

  return { outcome: "invalid", error };
}

function skipReason(fileEvent: AgentFileEvent): SpecReviewDelivery | null {
  if (fileEvent.event !== SPEC_REVIEW_RESULT_EVENT) {
    return { outcome: "skipped", error: "not a spec review result" };
  }

  return fileEvent.reason || fileEvent.content === null
    ? { outcome: "skipped", error: `no answer (${fileEvent.reason})` }
    : null;
}

// The newest run still going for the task — a rework re-runs the write node in the same run, so this is the run the review rides on.
async function openRunOfTask(
  taskId: string,
  assemblyRuns: Pick<AssemblyRunsPort, "listForTask">,
): Promise<AssemblyRunRecord | undefined> {
  const open = (await assemblyRuns.listForTask(taskId)).filter(
    (run) => run.status === "running" || run.status === "queued",
  );

  return open.at(0);
}

function reviewTargetOf(
  run: AssemblyRunRecord | undefined,
): ReviewTarget | null {
  const planId = run?.args.plan_id;
  const prNumber = run?.args.pr_number;

  return run && typeof planId === "string" && typeof prNumber === "number"
    ? { run, planId, prNumber }
    : null;
}

type ParsedResult =
  { ok: true; value: SpecReviewResult } | { ok: false; error: string };

function parseResult(content: string): ParsedResult {
  try {
    const parsed = specReviewResultSchema.safeParse(JSON.parse(content));

    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          error: `not a spec review result: ${parsed.error.message}`,
        };
  } catch (err) {
    return { ok: false, error: `not JSON: ${errorMessage(err)}` };
  }
}

async function deliver(
  target: ReviewTarget,
  result: SpecReviewResult,
  deps: SpecReviewResultDeps,
): Promise<SpecReviewDelivery> {
  const questions = await sendQuestions(target, result.plan_questions, deps);
  const replies = await postReplies(
    target,
    result.replies,
    await deps.pullsFor(target.run.repo),
  );

  return { outcome: "delivered", questions, ...replies };
}

/** The questions land on the plan, and the run is flagged so its next park on the PR wait reopens the plan for them. */
async function sendQuestions(
  target: ReviewTarget,
  questions: readonly PlanQuestion[],
  deps: SpecReviewResultDeps,
): Promise<number> {
  if (questions.length === 0) {
    return 0;
  }
  await deps.plans.addQuestions(target.planId, {
    actor: SPEC_WRITER_ACTOR,
    ops: questions.map(addQuestionOp),
  });
  await deps.assemblyRuns.mergeArgs(target.run.id, {
    [SPEC_REVIEW_REOPEN_ARG]: true,
  });

  return questions.length;
}

/** One `add-question` op; the id is stable across redeliveries of the same answer, so planning-sync sees the same question twice rather than two questions. */
export function addQuestionOp(question: PlanQuestion): Record<string, unknown> {
  return {
    op: "add-question",
    slot: question.slot,
    questionId: `q-review-${djb2Hash(`${question.slot}\n${question.question}`)}`,
    question: question.question,
    why: question.why,
    kind: "text",
    options: [],
  };
}

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
  return `<!-- lore-spec-rework: ${runId}/${commentId} -->`;
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

async function postReplies(
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
function reviewBodyIds(target: ReviewTarget): Set<number> {
  const review = specReviewFromArgs(target.run.args);

  return new Set((review?.reviews ?? []).map((body) => body.id));
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
