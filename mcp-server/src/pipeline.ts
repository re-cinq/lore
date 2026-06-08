/**
 * Pipeline task CRUD. The policy-free CRUD (getTask/listTasks/updateTaskStatus/
 * recordEvent/cancelTask/markTaskMerged) lives once in @re-cinq/lore-shared and
 * is re-exported here; this file keeps the mcp-specific policy (trust-level gate
 * + getDefaultRepo on createTask, retry, review-iteration). Task processing
 * itself is handled by the lore-agent service.
 */

import { getDefaultRepo } from './pipeline-config.js';
import {
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

// Trust level hierarchy — what task types each level allows
const TRUST_LEVELS: Record<string, string[]> = {
  docs: ['gap-fill', 'runbook'],
  tests: ['gap-fill', 'runbook', 'review'],
  implementation: ['gap-fill', 'runbook', 'review', 'implementation', 'feature-request', 'general'],
  full: ['gap-fill', 'runbook', 'review', 'implementation', 'feature-request', 'general', 'onboard'],
};

export async function createTask(
  description: string,
  taskType: string = 'general',
  targetRepo?: string,
  createdBy: string = 'ui',
  contextBundle?: any,
  priority: string = 'normal',
  taskGroupId?: string,
  contextRefs?: { fact_ids: string[]; memory_ids: string[] },
): Promise<any> {
  const repo = targetRepo || getDefaultRepo(taskType);
  if (description.length > 10000) throw new Error('Description too long (max 10000 chars)');

  // Check trust level for the target repo
  if (repo) {
    try {
      const { rows: repoRows } = await getPool().query(
        `SELECT settings FROM lore.repos WHERE full_name = $1`, [repo],
      );
      if (repoRows.length > 0) {
        const settings = repoRows[0].settings || {};
        const trustLevel = settings.trust?.level;
        if (trustLevel && TRUST_LEVELS[trustLevel]) {
          const allowed = TRUST_LEVELS[trustLevel];
          if (!allowed.includes(taskType)) {
            throw new Error(`Task type "${taskType}" not allowed at trust level "${trustLevel}" for ${repo}. Allowed: ${allowed.join(', ')}`);
          }
        }
      }
    } catch (err: any) {
      if (err.message.includes('not allowed at trust level')) throw err;
      // Non-trust errors are non-fatal
    }
  }

  const resolvedPriority = priority === 'immediate' ? 'immediate' : 'normal';
  const contextJson = contextBundle ? JSON.stringify(contextBundle) : null;
  let rows: any[];
  if (taskGroupId) {
    // Only reference task_group_id column when a group is specified (column may not exist on older schemas)
    const result = await getPool().query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority, task_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, priority, created_at`,
      [description, taskType, repo, createdBy, contextJson, resolvedPriority, taskGroupId],
    );
    rows = result.rows;
  } else {
    const result = await getPool().query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, priority, created_at`,
      [description, taskType, repo, createdBy, contextJson, resolvedPriority],
    );
    rows = result.rows;
  }
  const task = rows[0];
  // Store context refs for outcome feedback (which facts/memories contributed)
  if (contextRefs && (contextRefs.fact_ids.length > 0 || contextRefs.memory_ids.length > 0)) {
    await getPool().query(
      `UPDATE pipeline.tasks SET context_refs = $1 WHERE id = $2`,
      [JSON.stringify(contextRefs), task.id],
    ).catch(() => {}); // non-fatal if column doesn't exist yet
  }
  await recordEvent(task.id, null, 'pending', { created_by: createdBy, priority: resolvedPriority });
  return { task_id: task.id, task_type: taskType, status: task.status, priority: task.priority, created_at: task.created_at };
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

