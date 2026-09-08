// A review Agent's terminal verdict driving the iteration-capped auto-fix loop on the parent implementation task.
import type { PipelineTask } from "@re-cinq/lore-shared";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline, taskStore } from "../../outbound/queues.js";
import {
  buildReviewFixDescription,
  formatReviewFeedback,
} from "@re-cinq/lore-shared";
import { type ReviewResult } from "../../domain/agent-watcher-logic.js";
import { type AgentContext, getIssueNumber } from "./agent-watcher-notify.js";

/** Best-effort Issue comment: the thread is a courtesy, and a comment failure must not derail the task's own settlement. */
async function commentOnIssue(
  targetRepo: string,
  issueNumber: number | null | undefined,
  body: string,
): Promise<void> {
  if (!issueNumber) {
    return;
  }

  await projectFor(targetRepo)
    .then((p) => p.issues.comment(issueNumber, body))
    .catch(() => {});
}

async function completeApprovedReview(
  taskId: string,
  parentTaskId: string,
): Promise<void> {
  await taskStore().setStatus(parentTaskId, "completed");
  await taskStore().recordEvent(parentTaskId, "review", "completed", {
    review_result: "approved",
    review_task_id: taskId,
  });
  const { issue_number, target_repo } = await getIssueNumber(parentTaskId);

  await commentOnIssue(
    target_repo,
    issue_number,
    "Agent review: **approved**. PR is ready for human merge.",
  );
  await taskStore().setStatus(taskId, "completed");
  console.log(
    `[agent-watcher] Review approved for parent task ${parentTaskId}`,
  );
}

/** Tells the Issue thread the loop has given up and labels it for a human. */
async function markIssueNeedsHumanReview(
  parent: PipelineTask,
  iteration: number,
): Promise<void> {
  await commentOnIssue(
    parent.target_repo,
    parent.issue_number,
    `Agent review: changes requested (iteration ${iteration}/2). Escalating to human review.`,
  );

  if (!parent.issue_number) {
    return;
  }

  await projectFor(parent.target_repo)
    .then((p) => p.issues.addLabel(parent.issue_number!, "needs-human-review"))
    .catch(() => {});
}

async function escalateReviewToHuman(
  taskId: string,
  parentTaskId: string,
  parent: PipelineTask,
  iteration: number,
): Promise<void> {
  await taskStore().recordEvent(parentTaskId, "review", "review", {
    review_result: "needs-human-review",
    iterations: iteration,
  });

  await markIssueNeedsHumanReview(parent, iteration);
  await taskStore().setStatus(taskId, "completed");
  console.log(
    `[agent-watcher] Review escalated to human for ${parentTaskId} (iteration ${iteration})`,
  );
}

/** Resolves the review task's parent, or undefined if the review is stale/re-entrant or carries no parent link. */
async function resolveReviewParentTaskId(
  taskId: string,
): Promise<string | undefined> {
  const reviewTask = await taskStore().getById(taskId);

  if (reviewTask && reviewTask.status !== "running") {
    return undefined;
  }
  const contextBundle = reviewTask?.context_bundle as
    { parent_task_id?: string } | undefined;
  const parentTaskId = contextBundle?.parent_task_id;

  if (!parentTaskId) {
    console.log(
      `[agent-watcher] Review ${taskId} has no parent task, skipping`,
    );
  }

  return parentTaskId;
}

/** Opens (or re-drives) the auto-fix implementation task addressing the review's requested changes. */
async function fetchReviewComments(parent: PipelineTask) {
  if (!parent.pr_number) {
    return [];
  }

  return await projectFor(parent.target_repo)
    .then((p) => p.pulls.listComments(parent.pr_number!))
    .catch(() => []);
}

/** The fix task row. It comes FIRST: the Agent run is keyed to it, and a run with no row behind it produces work nobody can find. */
async function insertFixTask(
  parent: PipelineTask,
  work: { fixDescription: string; feedback: string },
): Promise<string> {
  return (await pipeline().taskQueue.insertTask({
    description: work.fixDescription,
    taskType: "implementation",
    targetRepo: parent.target_repo,
    createdBy: "review-loop",
    contextBundle: {
      branch: parent.target_branch,
      review_feedback: work.feedback,
      parent_task_id: parent.id,
    },
  })) as string;
}

/** The fix runs on the PARENT's branch, not a new one: the PR already exists, and the loop is meant to push onto it rather than open a second. */
async function startFixTask(
  parent: PipelineTask,
  branch: string,
  work: { fixDescription: string; feedback: string },
): Promise<string> {
  const fixTaskId = await insertFixTask(parent, work);

  await (
    await projectFor(parent.target_repo)
  ).agents.run(fixTaskId, {
    mode: "cluster",
    taskType: "implementation",
    description: work.fixDescription,
    prompt: `Address the following review feedback on PR #${parent.pr_number ?? "?"}. The PR already exists — push fixes to the same branch.\n\nFeedback:\n${work.feedback}`,
    branch: parent.target_branch || branch,
    model: "claude-sonnet-4-6",
    timeoutMinutes: 30,
  });

  return fixTaskId;
}

/** Tells the Issue thread that a fix is already in flight, so a human reading it does not start the same work. */
async function noteFixOnIssue(
  parent: PipelineTask,
  iteration: number,
): Promise<void> {
  await commentOnIssue(
    parent.target_repo,
    parent.issue_number,
    `Agent review: changes requested (iteration ${iteration}/2). Auto-fixing...`,
  );
}

/** The review's own comments, or a fallback pointing the fix agent at the PR when there are none to quote. */
async function reviewFeedbackFor(parent: PipelineTask): Promise<string> {
  return (
    formatReviewFeedback(await fetchReviewComments(parent)) ||
    "The agent review requested changes. Read the review comments on the PR and address them."
  );
}

async function requestReviewFix(
  taskId: string,
  branch: string,
  parent: PipelineTask,
  iteration: number,
): Promise<void> {
  const fixTaskId = await startFixTask(parent, branch, {
    fixDescription: buildReviewFixDescription({
      prNumber: parent.pr_number ?? null,
      iteration,
    }),
    feedback: await reviewFeedbackFor(parent),
  });

  await noteFixOnIssue(parent, iteration);
  await taskStore().setStatus(taskId, "completed");
  console.log(
    `[agent-watcher] Review changes requested, created fix task ${fixTaskId} (iteration ${iteration})`,
  );
}

/** Changes-requested: bump the parent's iteration counter, then either escalate or open the auto-fix task. */
async function driveChangesRequested(
  ctx: AgentContext,
  parentTaskId: string,
): Promise<void> {
  const parent = await taskStore().getById(parentTaskId);

  if (!parent) {
    return;
  }
  const iteration = (Number(parent.review_iteration) || 0) + 1;

  await pipeline().taskQueue.setColumns(parentTaskId, {
    review_iteration: iteration,
  });

  if (iteration >= 2) {
    await escalateReviewToHuman(ctx.taskId, parentTaskId, parent, iteration);

    return;
  }
  await requestReviewFix(ctx.taskId, ctx.branch, parent, iteration);
}

/** A review Agent's verdict drives the iteration-capped fix loop on the parent task. */
export async function handleReviewVerdict(
  ctx: AgentContext,
  reviewResult: ReviewResult,
): Promise<void> {
  const parentTaskId = await resolveReviewParentTaskId(ctx.taskId);

  if (!parentTaskId) {
    return;
  }

  if (reviewResult === "approved") {
    await completeApprovedReview(ctx.taskId, parentTaskId);

    return;
  }
  await driveChangesRequested(ctx, parentTaskId);
}
