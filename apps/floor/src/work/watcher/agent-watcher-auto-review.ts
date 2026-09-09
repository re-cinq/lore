// Opt-in auto-review (per-repo setting): files a review task against a just-opened PR and dispatches its Agent.
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline, taskStore } from "../../outbound/queues.js";
import { shouldAutoReview } from "../../outbound/should-auto-review.js";
import type { AgentContext } from "./agent-watcher-notify.js";
import type { OpenedPr } from "./agent-watcher-pr-delivery.js";

const REVIEW_PROMPT_TEMPLATE = (prNumber: number) =>
  `Review PR #${prNumber} on this branch. Read the spec in specs/ for the feature requirements. Check all changes against CLAUDE.md conventions and ADRs in adrs/. Post specific review comments on the PR using 'gh pr review'. Then output exactly one of:\n- REVIEW_RESULT:APPROVED\n- REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>`;

/** Dispatches a review Agent against the just-opened PR when the repo opted in. */
export async function maybeStartAutoReview(
  ctx: AgentContext,
  pr: OpenedPr["pr"],
): Promise<void> {
  const { taskId, targetRepo } = ctx;

  if (!(await shouldAutoReview(targetRepo))) {
    return;
  }
  const reviewTaskId = await dispatchReview(ctx, pr);

  await taskStore().setStatus(taskId, "review");
  await taskStore().recordEvent(taskId, "pr-created", "review", {
    review_task_id: reviewTaskId,
    auto_review: true,
  });
  console.log(
    `[agent-watcher] Auto-review: created review task ${reviewTaskId} for PR #${pr.number}`,
  );
}

/** Files the review task and dispatches its Agent. */
async function dispatchReview(
  ctx: AgentContext,
  pr: OpenedPr["pr"],
): Promise<string> {
  const description = `Review PR #${pr.number} on ${ctx.targetRepo}`;
  const reviewTaskId = await insertReviewTask(ctx, pr, description);

  await (
    await projectFor(ctx.targetRepo)
  ).agents.run(reviewTaskId, {
    mode: "cluster",
    taskType: "review",
    description,
    prompt: REVIEW_PROMPT_TEMPLATE(pr.number),
    branch: ctx.branch,
    prNumber: pr.number,
    model: "claude-sonnet-4-6",
    timeoutMinutes: 10,
  });

  return reviewTaskId;
}

/** The review task row. It comes FIRST: the Agent run is keyed to it, and an Agent with no row behind it produces a review nobody can find. */
async function insertReviewTask(
  ctx: AgentContext,
  pr: OpenedPr["pr"],
  description: string,
): Promise<string> {
  return (await pipeline().taskQueue.insertTask({
    description,
    taskType: "review",
    targetRepo: ctx.targetRepo,
    createdBy: "agent-watcher",
    contextBundle: {
      pr_number: pr.number,
      branch: ctx.branch,
      parent_task_id: ctx.taskId,
    },
  })) as string;
}
