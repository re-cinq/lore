/**
 * Pipeline task CRUD. Task processing is handled by the lore-agent service.
 */

import { getDefaultRepo } from './pipeline-config.js';

// ── Pool management ──────────────────────────────────────────────────

import type { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) throw new Error("Pipeline database not configured");
  return pool;
}

export function setPipelinePool(p: Pool): void { pool = p; }

// ── Task CRUD ────────────────────────────────────────────────────────

export async function createTask(
  description: string,
  taskType: string = 'general',
  targetRepo?: string,
  createdBy: string = 'ui',
  contextBundle?: any,
  priority: string = 'normal',
): Promise<any> {
  const repo = targetRepo || getDefaultRepo(taskType);
  if (description.length > 10000) throw new Error('Description too long (max 10000 chars)');
  const resolvedPriority = priority === 'immediate' ? 'immediate' : 'normal';
  const { rows } = await getPool().query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, status, priority, created_at`,
    [description, taskType, repo, createdBy, contextBundle ? JSON.stringify(contextBundle) : null, resolvedPriority],
  );
  const task = rows[0];
  await recordEvent(task.id, null, 'pending', { created_by: createdBy, priority: resolvedPriority });
  return { task_id: task.id, status: task.status, priority: task.priority, created_at: task.created_at };
}

export async function getTask(taskId: string): Promise<any> {
  const { rows: tasks } = await getPool().query(
    `SELECT * FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );
  if (tasks.length === 0) return null;
  const { rows: events } = await getPool().query(
    `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );
  return { ...tasks[0], events };
}

export async function listTasks(status?: string, limit: number = 50): Promise<any> {
  const where = status ? 'WHERE status = $1' : '';
  const params = status ? [status, limit] : [limit];
  const { rows } = await getPool().query(
    `SELECT id, description, task_type, status, target_repo, agent_id, pr_url, created_by, created_at, updated_at
     FROM pipeline.tasks ${where}
     ORDER BY created_at DESC
     LIMIT $${status ? '2' : '1'}`,
    params,
  );
  const { rows: countRows } = await getPool().query(
    `SELECT count(*)::int as total FROM pipeline.tasks ${where}`,
    status ? [status] : [],
  );
  return { tasks: rows, total: countRows[0].total };
}

export async function cancelTask(taskId: string): Promise<any> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (['merged', 'failed', 'cancelled'].includes(task.status)) {
    throw new Error(`Cannot cancel task in ${task.status} state`);
  }
  await updateTaskStatus(taskId, 'cancelled', { cancelled_by: 'user' });
  return { task_id: taskId, status: 'cancelled' };
}

// ── Status management ────────────────────────────────────────────────

export async function updateTaskStatus(taskId: string, newStatus: string, meta?: any): Promise<void> {
  const { rows } = await getPool().query(
    `SELECT status FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );
  if (rows.length === 0) return;
  const oldStatus = rows[0].status;
  await getPool().query(
    `UPDATE pipeline.tasks SET status = $1 WHERE id = $2`,
    [newStatus, taskId],
  );
  await recordEvent(taskId, oldStatus, newStatus, meta);
}

export async function recordEvent(taskId: string, fromStatus: string | null, toStatus: string | null, meta?: any): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
       VALUES ($1, $2, $3, $4)`,
      [taskId, fromStatus, toStatus, meta ? JSON.stringify(meta) : null],
    );
  } catch {
    // Event recording failures must never block pipeline operations
  }
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

// ── Task retry ──────────────────────────────────────────────────────

export async function retryTask(taskId: string): Promise<any> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'failed' && task.status !== 'needs-human-help') {
    throw new Error(`Cannot retry task in ${task.status} state (must be failed or needs-human-help)`);
  }
  // Create a new task with the same parameters
  const result = await createTask(
    task.description,
    task.task_type,
    task.target_repo,
    `retry:${task.created_by}`,
    { ...(task.context_bundle || {}), retry_of: taskId },
  );
  // Mark the original as retried
  await updateTaskStatus(taskId, 'retried', { retried_as: result.task_id });
  return { task_id: result.task_id, status: result.status, retry_of: taskId };
}

// ── PR merge management (T028) ──────────────────────────────────────

export async function markTaskMerged(taskId: string): Promise<any> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'pr-created' && task.status !== 'review') {
    throw new Error(`Cannot mark task as merged from ${task.status} state (expected pr-created or review)`);
  }
  await updateTaskStatus(taskId, 'merged', { merged_by: 'manual' });
  return { task_id: taskId, status: 'merged' };
}
