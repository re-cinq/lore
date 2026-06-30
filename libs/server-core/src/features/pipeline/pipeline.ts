/**
 * Pipeline task CRUD. The policy-free CRUD (getTask/listTasks/updateTaskStatus/
 * recordEvent/cancelTask/markTaskMerged) lives once in @re-cinq/lore-shared and
 * is re-exported here; this file keeps the mcp-specific policy (trust-level gate
 * + getDefaultRepo on createTask, retry, review-iteration). Task processing
 * itself is handled by the Floor service.
 */

import { getDefaultRepo } from './pipeline-config.js';
import {
  createPipelineTask,
  retryPipelineTask,
  getPipelineTask,
  listPipelineTasks,
  recordTaskEvent,
  updateTaskStatus as sharedUpdateTaskStatus,
  cancelPipelineTask,
  markTaskMerged as sharedMarkTaskMerged,
} from '@re-cinq/lore-shared';

// ── Pool management ──────────────────────────────────────────────────

import type { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) throw new Error("Pipeline database not configured");
  return pool;
}

export function setPipelinePool(p: Pool): void { pool = p; }

// ── Relocated CRUD (single source in shared; thin pool-binding wrappers) ──
export const getTask = (taskId: string) => getPipelineTask(getPool(), taskId);
export const listTasks = (status?: string, limit = 50) => listPipelineTasks(getPool(), status, limit);
export const recordEvent = (taskId: string, fromStatus: string | null, toStatus: string | null, meta?: any) =>
  recordTaskEvent(getPool(), taskId, fromStatus, toStatus, meta);
export const updateTaskStatus = (taskId: string, newStatus: string, meta?: any) =>
  sharedUpdateTaskStatus(getPool(), taskId, newStatus, meta);
export const cancelTask = (taskId: string) => cancelPipelineTask(getPool(), taskId);
export const markTaskMerged = (taskId: string) => sharedMarkTaskMerged(getPool(), taskId);

// ── Task CRUD ────────────────────────────────────────────────────────

// createTask is single-sourced in shared (trust-gate + insert + recordEvent);
// mcp keeps its positional signature and resolves the default repo via config.
export function createTask(
  description: string,
  taskType: string = 'general',
  targetRepo?: string,
  createdBy: string = 'ui',
  contextBundle?: any,
  priority: string = 'normal',
  taskGroupId?: string,
  contextRefs?: { fact_ids: string[]; memory_ids: string[] },
): Promise<any> {
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

export async function handleReviewResult(taskId: string, approved: boolean, comments: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;

  if (approved) {
    await updateTaskStatus(taskId, 'review', { review_result: 'approved', comments });
    // Agent approval logged but human still needs to approve
  } else {
    // Check iteration count
    const iteration = (task.review_iteration || 0) + 1;
    await getPool().query(
      `UPDATE pipeline.tasks SET review_iteration = $1 WHERE id = $2`,
      [iteration, taskId],
    );

    if (iteration >= 2) {
      // Max iterations reached, escalate to human
      await updateTaskStatus(taskId, 'review', {
        review_result: 'needs-human-review',
        comments,
        iterations: iteration,
      });
    } else {
      // Re-trigger implementation agent with review feedback (immediate — active feedback loop)
      await createTask(
        `Address review feedback on PR: ${comments.substring(0, 200)}`,
        task.task_type,
        task.target_repo,
        'review-agent',
        { branch: task.target_branch, review_comments: comments },
        'immediate',
      );
      await updateTaskStatus(taskId, 'review', { review_result: 'changes-requested', iteration });
    }
  }
}

// ── Task retry (single source in shared) ────────────────────────────

export const retryTask = (taskId: string) => retryPipelineTask(getPool(), taskId);

