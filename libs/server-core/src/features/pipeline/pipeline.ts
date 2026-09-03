import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * Pipeline task CRUD. The policy-free CRUD (getTask/listTasks/updateTaskStatus/
 * recordEvent/cancelTask/markTaskMerged) lives once in @re-cinq/lore-shared and
 * is re-exported here; this file keeps the mcp-specific policy (trust-level gate
 * + getDefaultRepo on createTask, retry, review-iteration). Task processing
 * itself is handled by the Floor service.
 */

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

// createTask is single-sourced in shared (trust-gate + insert + recordEvent);
// mcp keeps its positional signature and resolves the default repo via config.
export interface CreateTaskInput {
  description: string;
  taskType?: string;
  targetRepo?: string;
  createdBy?: string;
  contextBundle?: Record<string, unknown>;
  priority?: string;
  taskGroupId?: string;
  contextRefs?: { fact_ids: string[]; memory_ids: string[] };
}

export function createTask({
  description,
  taskType = "general",
  targetRepo,
  createdBy = "ui",
  contextBundle,
  priority = "normal",
  taskGroupId,
  contextRefs,
}: CreateTaskInput): Promise<{
  task_id: string;
  task_type: string;
  status: string;
  priority: string;
  created_at: string;
}> {
  return createPipelineTask(getPool(), {
    description,
    taskType,
    targetRepo: targetRepo || getDefaultRepo(taskType),
    createdBy,
    contextBundle,
    priority,
    taskGroupId,
    contextRefs,
  });
}

// ── Review iteration (T025) ─────────────────────────────────────────

export async function handleReviewResult(
  taskId: string,
  approved: boolean,
  comments: string,
): Promise<void> {
  const task = await getTask(taskId);

  if (!task) {
    return;
  }

  if (approved) {
    // Agent approval logged but human still needs to approve
    await updateTaskStatus(taskId, "review", {
      review_result: "approved",
      comments,
    });

    return;
  }

  // Check iteration count
  const iteration = ((task.review_iteration as number) || 0) + 1;

  await getPool().query(
    `UPDATE pipeline.tasks SET review_iteration = $1 WHERE id = $2`,
    [iteration, taskId],
  );

  if (iteration >= 2) {
    // Max iterations reached, escalate to human
    await updateTaskStatus(taskId, "review", {
      review_result: "needs-human-review",
      comments,
      iterations: iteration,
    });

    return;
  }

  // Re-trigger implementation agent with review feedback (immediate — active feedback loop)
  await createTask({
    description: `Address review feedback on PR: ${comments.substring(0, 200)}`,
    taskType: task.task_type as string,
    targetRepo: task.target_repo ?? undefined,
    createdBy: "review-agent",
    contextBundle: { branch: task.target_branch, review_comments: comments },
    priority: "immediate",
  });
  await updateTaskStatus(taskId, "review", {
    review_result: "changes-requested",
    iteration,
  });
}

// ── Task retry (single source in shared) ────────────────────────────

export const retryTask = (taskId: string) =>
  retryPipelineTask(getPool(), taskId);
