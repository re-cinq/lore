import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Pipeline task CRUD with mcp-specific policy (trust-gate + getDefaultRepo). */

import { getDefaultRepo } from "./pipeline-config.js";
import {
  createPipelineTask,
  retryPipelineTask,
  getPipelineTask,
  listPipelineTasks,
  recordTaskEvent,
  updateTaskStatus as sharedUpdateTaskStatus,
  cancelPipelineTask,
  markTaskMerged as sharedMarkTaskMerged,
  type CreateTaskInput,
  type PipelineTaskRow,
  type TaskListRow,
} from "@re-cinq/lore-shared";

// ── Pool management ──────────────────────────────────────────────────

import type { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  enforceTrue(pool, Error, "Pipeline database not configured");

  return pool;
}

export function setPipelinePool(p: Pool): void {
  pool = p;
}

// ── Relocated CRUD (single source in shared; thin pool-binding wrappers) ──
export const getTask = (
  taskId: string,
): Promise<(PipelineTaskRow & { events: Record<string, unknown>[] }) | null> =>
  getPipelineTask(getPool(), taskId);
export const listTasks = (
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ tasks: TaskListRow[]; total: number }> =>
  listPipelineTasks(getPool(), status, limit, offset);
export const recordEvent = (
  taskId: string,
  fromStatus: string | null,
  toStatus: string | null,
  meta?: Record<string, unknown>,
) =>
  recordTaskEvent(getPool(), taskId, { from: fromStatus, to: toStatus }, meta);
export const updateTaskStatus = (
  taskId: string,
  newStatus: string,
  meta?: Record<string, unknown>,
) => sharedUpdateTaskStatus(getPool(), taskId, newStatus, meta);
export const cancelTask = (taskId: string) =>
  cancelPipelineTask(getPool(), taskId);
export const markTaskMerged = (taskId: string) =>
  sharedMarkTaskMerged(getPool(), taskId);

// ── Task CRUD ────────────────────────────────────────────────────────

// createTask single-sourced in shared; mcp adds trust-gate + default repo resolve.
export type { CreateTaskInput } from "@re-cinq/lore-shared";

export function createTask(
  input: CreateTaskInput,
): Promise<Awaited<ReturnType<typeof createPipelineTask>>> {
  const taskType = input.taskType ?? "general";

  return createPipelineTask(getPool(), {
    ...input,
    taskType,
    // A task with no repo of its own goes to the task type's default — the pipeline cannot dispatch one that names no repo at all.
    targetRepo: input.targetRepo || getDefaultRepo(taskType),
    createdBy: input.createdBy ?? "ui",
    priority: input.priority ?? "normal",
  });
}

// ── Review iteration (T025) ─────────────────────────────────────────

export async function handleReviewResult(
  taskId: string,
  verdict: "approved" | "changes_requested",
  comments: string,
): Promise<void> {
  const task = await getTask(taskId);

  if (!task) {
    return;
  }

  if (verdict === "approved") {
    await recordApproval(taskId, comments);

    return;
  }
  const iteration = ((task.review_iteration as number) || 0) + 1;

  // Counted BEFORE the retry is created, so a crash mid-dispatch cannot replay the same iteration forever.
  await getPool().query(
    `UPDATE pipeline.tasks SET review_iteration = $1 WHERE id = $2`,
    [iteration, taskId],
  );

  await escalateOrIterate(task, taskId, iteration, comments);
}

// Agent approval is RECORDED, not acted on — a human still merges. Writing it here is what lets the PR page say the review passed without the pipeline treating that as permission.
async function recordApproval(taskId: string, comments: string): Promise<void> {
  await updateTaskStatus(taskId, "review", {
    review_result: "approved",
    comments,
  });
}

/** A second round of changes goes to a human: two agent-driven iterations on the same PR have not converged, and a third would spend tokens re-litigating the same comments. */
async function escalateOrIterate(
  task: { task_type: unknown; target_repo: string; target_branch?: string },
  taskId: string,
  iteration: number,
  comments: string,
): Promise<void> {
  if (iteration >= 2) {
    await updateTaskStatus(taskId, "review", {
      review_result: "needs-human-review",
      comments,
      iterations: iteration,
    });

    return;
  }

  await createTask(revisionTask(task, comments));
  await updateTaskStatus(taskId, "review", {
    review_result: "changes-requested",
    iteration,
  });
}

// Another pass at the same PR. `immediate` because this closes an ACTIVE feedback loop — the reviewer is waiting on a PR that already exists, not queueing new work behind it.
function revisionTask(
  task: { task_type: unknown; target_repo: string; target_branch?: string },
  comments: string,
): CreateTaskInput {
  return {
    description: `Address review feedback on PR: ${comments.substring(0, 200)}`,
    taskType: task.task_type as string,
    targetRepo: task.target_repo,
    createdBy: "review-agent",
    contextBundle: { branch: task.target_branch, review_comments: comments },
    priority: "immediate",
  };
}

// ── Task retry (single source in shared) ────────────────────────────

export const retryTask = (taskId: string) =>
  retryPipelineTask(getPool(), taskId);
