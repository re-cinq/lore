/** Task lifecycle actions layered on pipeline-tasks.ts's core CRUD: retry, cancel, escalate, revise, mark-merged. */

import { enforceTrue } from "./lib/enforce.js";
import type { PgPool } from "./memory-store.js";
import {
  createTask,
  getTask,
  recordEvent,
  updateTaskStatus,
  type CreatedTask,
  type RetriedTask,
} from "./pipeline-task-core.js";

export async function retryTask(
  pool: PgPool,
  taskId: string,
): Promise<RetriedTask> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    !(task.status !== "failed" && task.status !== "needs-human-help"),
    Error,
    `Cannot retry task in ${task.status} state (must be failed or needs-human-help)`,
  );
  const result: CreatedTask = await createTask(pool, {
    description: task.description,
    taskType: task.task_type,
    targetRepo: task.target_repo,
    createdBy: `retry:${task.created_by}`,
    contextBundle: { ...(task.context_bundle || {}), retry_of: taskId },
  });

  await updateTaskStatus(pool, taskId, "retried", {
    retried_as: result.task_id,
  });

  return { task_id: result.task_id, status: result.status, retry_of: taskId };
}

export async function cancelTask(
  pool: PgPool,
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    // `completed` belongs here: its absence made the same click answer 400 in the web UI and 200 through this seam.
    !["completed", "merged", "failed", "cancelled"].includes(task.status),
    Error,
    `Cannot cancel task in ${task.status} state`,
  );
  await updateTaskStatus(pool, taskId, "cancelled", { cancelled_by: "user" });

  return { task_id: taskId, status: "cancelled" };
}

/** Run-now: jumps a queued task to the front of the poll order; refuses (rather than no-op) an unknown id or a task already past `pending`, and logs the escalation to pipeline.task_events. */
export async function escalateTask(
  pool: PgPool,
  taskId: string,
): Promise<{ task_id: string; priority: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    task.status === "pending",
    Error,
    `Can only escalate pending tasks, current status: ${task.status}`,
  );
  await pool.query(
    `UPDATE pipeline.tasks SET priority = 'immediate', updated_at = now() WHERE id = $1`,
    [taskId],
  );
  await recordEvent(
    pool,
    taskId,
    { from: task.status, to: task.status },
    {
      action: "run-now",
      previous_priority: task.priority,
    },
  );

  return { task_id: taskId, priority: "immediate" };
}

/** Queues a revision of a task from human feedback: a follow-up task on the SAME branch/PR at immediate priority, with the parent moved to `revision-requested`. */
export async function reviseTask(
  pool: PgPool,
  taskId: string,
  feedback: string,
): Promise<{ task_id: string; revision_task_id: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(Boolean(feedback.trim()), Error, "Feedback is required");

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
     VALUES ($1, $2, $3, $4, $5, 'immediate') RETURNING id`,
    [
      `Revise based on feedback: ${feedback.substring(0, 200)}`,
      task.task_type === "feature-request"
        ? "feature-request"
        : "implementation",
      task.target_repo,
      "ui-feedback",
      JSON.stringify({
        parent_task_id: taskId,
        branch: task.target_branch,
        pr_number: task.pr_number,
        feedback,
      }),
    ],
  );
  const revisionTaskId = rows[0].id;

  await recordEvent(
    pool,
    taskId,
    { from: task.status, to: "revision-requested" },
    {
      feedback,
      revision_task_id: revisionTaskId,
    },
  );
  await pool.query(
    `UPDATE pipeline.tasks SET status = 'revision-requested', updated_at = now() WHERE id = $1`,
    [taskId],
  );

  return { task_id: taskId, revision_task_id: revisionTaskId };
}

export async function markTaskMerged(
  pool: PgPool,
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    !(task.status !== "pr-created" && task.status !== "review"),
    Error,
    `Cannot mark task as merged from ${task.status} state (expected pr-created or review)`,
  );
  await updateTaskStatus(pool, taskId, "merged", { merged_by: "manual" });

  return { task_id: taskId, status: "merged" };
}
