// The spec writer's answer to the spec review (specs/7-feature-planning, "Rework from the spec review"), delivered where each half belongs: a question it could not settle goes to the plan for its people, and every reviewed comment gets a reply on the PR — the pod holds no API token and no `gh`, so the Floor carries both. Never merged into the run's args (artifact-args OWNED_ELSEWHERE).

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import {
  SPEC_REVIEW_REOPEN_ARG,
  SPEC_REVIEW_RESULT_EVENT,
  specReviewResultSchema,
  type SpecReviewResult,
} from "@re-cinq/lore-shared/review/spec-review.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { PlanWriter } from "../../domain/plan-writer.js";
import type { AgentFileEvent } from "./agent-events.js";
import {
  postReplies,
  type ReviewTarget,
  type SpecReviewReplyPoster,
} from "./spec-review-replies.js";

export {
  replyMarker,
  replyText,
  type SpecReviewReplyPoster,
} from "./spec-review-replies.js";

/** Who the plan's people see asking. */
export const SPEC_WRITER_ACTOR = "spec-writer";

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

type PlanQuestion = SpecReviewResult["plan_questions"][number];

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

/** One `add-question` op; the id is stable across reworks — keyed on the review comment the question answers for, so a rework that rewords it replaces it, and on the text only for a question tied to no comment. */
export function addQuestionOp(question: PlanQuestion): Record<string, unknown> {
  return {
    op: "add-question",
    slot: question.slot,
    questionId: questionIdOf(question),
    question: question.question,
    why: question.why,
    kind: "text",
    options: [],
  };
}

function questionIdOf(question: PlanQuestion): string {
  return question.comment_id === undefined
    ? `q-review-${djb2Hash(`${question.slot}\n${question.question}`)}`
    : `q-review-c${question.comment_id}`;
}
