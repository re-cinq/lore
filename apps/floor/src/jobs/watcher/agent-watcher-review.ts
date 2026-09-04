// A review Agent's terminal verdict driving the iteration-capped auto-fix loop on the parent implementation task.
import type { PipelineTask } from "@re-cinq/lore-shared";
import { projectFor } from "../../composition/project-boot.js";
import { pipeline, taskStore } from "../../kernel/queues.js";
import {
  buildReviewFixDescription,
  formatReviewFeedback,
} from "@re-cinq/lore-shared";
import { type ReviewResult } from "./agent-watcher-logic.js";
import { type AgentContext, getIssueNumber } from "./agent-watcher-notify.js";

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

  if (issue_number) {
    await projectFor(target_repo)
      .then((p) =>
        p.issues.comment(
          issue_number,
          "Agent review: **approved**. PR is ready for human merge.",
        ),
      )
      .catch(() => {});
  }
  await taskStore().setStatus(taskId, "completed");
  console.log(
    `[agent-watcher] Review approved for parent task ${parentTaskId}`,
  );
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

  if (parent.issue_number) {
    await projectFor(parent.target_repo)
      .then((p) =>
        p.issues.comment(
          parent.issue_number!,
          `Agent review: changes requested (iteration ${iteration}/2). Escalating to human review.`,
        ),
      )
      .catch(() => {});
    await projectFor(parent.target_repo)
      .then((p) =>
        p.issues.addLabel(parent.issue_number!, "needs-human-review"),
      )
      .catch(() => {});
  }
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

async function requestReviewFix(
  taskId: string,
  branch: string,
  parent: PipelineTask,
  iteration: number,
): Promise<void> {
  const comments = await fetchReviewComments(parent);
  const feedback =
    formatReviewFeedback(comments) ||
    "The agent review requested changes. Read the review comments on the PR and address them.";
  const fixDescription = buildReviewFixDescription({
    prNumber: parent.pr_number ?? null,
    iteration,
  });
  const fixTaskId = (await pipeline().taskQueue.insertTask({
    description: fixDescription,
    taskType: "implementation",
    targetRepo: parent.target_repo,
    createdBy: "review-loop",
    contextBundle: {
      branch: parent.target_branch,
      review_feedback: feedback,
      parent_task_id: parent.id,
    },
  })) as string;

  await (
    await projectFor(parent.target_repo)
  ).agents.run(fixTaskId, {
    mode: "cluster",
    taskType: "implementation",
    description: fixDescription,
    prompt: `Address the following review feedback on PR #${parent.pr_number ?? "?"}. The PR already exists — push fixes to the same branch.\n\nFeedback:\n${feedback}`,
    branch: parent.target_branch || branch,
    model: "claude-sonnet-4-6",
    timeoutMinutes: 30,
  });

  if (parent.issue_number) {
    await projectFor(parent.target_repo)
      .then((p) =>
        p.issues.comment(
          parent.issue_number!,
          `Agent review: changes requested (iteration ${iteration}/2). Auto-fixing...`,
        ),
      )
      .catch(() => {});
  }
  await taskStore().setStatus(taskId, "completed");
  console.log(
    `[agent-watcher] Review changes requested, created fix task ${fixTaskId} (iteration ${iteration})`,
  );
}

/** A review Agent's verdict drives the iteration-capped fix loop on the parent task. */
export async function handleReviewVerdict(
  ctx: AgentContext,
  reviewResult: ReviewResult,
): Promise<void> {
  const { taskId, branch } = ctx;
  const parentTaskId = await resolveReviewParentTaskId(taskId);

  if (!parentTaskId) {
    return;
  }

  if (reviewResult === "approved") {
    await completeApprovedReview(taskId, parentTaskId);

    return;
  }

  const parent = await taskStore().getById(parentTaskId);

  if (!parent) {
    return;
  }
  const iteration = (Number(parent.review_iteration) || 0) + 1;

  await pipeline().taskQueue.setColumns(parentTaskId, {
    review_iteration: iteration,
  });

  if (iteration >= 2) {
    await escalateReviewToHuman(taskId, parentTaskId, parent, iteration);

    return;
  }
  await requestReviewFix(taskId, branch, parent, iteration);
}
