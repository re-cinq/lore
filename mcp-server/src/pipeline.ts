/**
 * Core pipeline module.
 *
 * Provides task CRUD, status-event recording, a periodic poller that
 * picks up pending tasks, and an agent spawner that delegates work to
 * Klaus. Uses the same pool-injection pattern as memory.ts.
 */

import { resolveAgentId } from './agent-id.js';
import { getTaskTypeConfig, buildPrompt, getDefaultRepo, loadTaskTypes } from './pipeline-config.js';
import { submitTask as submitToKlaus, getTaskStatus as getKlausStatus } from './klaus-client.js';
import { buildContextBundle } from './context-bundle.js';

// ── Pool management ──────────────────────────────────────────────────

let pool: any = null;
const MAX_CONCURRENT = parseInt(process.env.LORE_MAX_AGENTS || '5', 10);
const POLL_INTERVAL = parseInt(process.env.LORE_POLL_INTERVAL || '10000', 10);

export function setPipelinePool(p: any): void { pool = p; }

// ── Task CRUD ────────────────────────────────────────────────────────

export async function createTask(
  description: string,
  taskType: string = 'general',
  targetRepo?: string,
  createdBy: string = 'ui',
  contextBundle?: any,
): Promise<any> {
  const repo = targetRepo || getDefaultRepo(taskType);
  const { rows } = await pool.query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, status, created_at`,
    [description, taskType, repo, createdBy, contextBundle ? JSON.stringify(contextBundle) : null],
  );
  const task = rows[0];
  await recordEvent(task.id, null, 'pending', { created_by: createdBy });
  return { task_id: task.id, status: task.status, created_at: task.created_at };
}

export async function getTask(taskId: string): Promise<any> {
  const { rows: tasks } = await pool.query(
    `SELECT * FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );
  if (tasks.length === 0) return null;
  const { rows: events } = await pool.query(
    `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );
  return { ...tasks[0], events };
}

export async function listTasks(status?: string, limit: number = 50): Promise<any> {
  const where = status ? 'WHERE status = $1' : '';
  const params = status ? [status, limit] : [limit];
  const { rows } = await pool.query(
    `SELECT id, description, task_type, status, target_repo, agent_id, pr_url, created_by, created_at, updated_at
     FROM pipeline.tasks ${where}
     ORDER BY created_at DESC
     LIMIT $${status ? '2' : '1'}`,
    params,
  );
  const { rows: countRows } = await pool.query(
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
  // TODO: kill running Klaus agent if active
  return { task_id: taskId, status: 'cancelled' };
}

// ── Status management ────────────────────────────────────────────────

export async function updateTaskStatus(taskId: string, newStatus: string, meta?: any): Promise<void> {
  const { rows } = await pool.query(
    `SELECT status FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );
  if (rows.length === 0) return;
  const oldStatus = rows[0].status;
  await pool.query(
    `UPDATE pipeline.tasks SET status = $1 WHERE id = $2`,
    [newStatus, taskId],
  );
  await recordEvent(taskId, oldStatus, newStatus, meta);
}

async function recordEvent(taskId: string, fromStatus: string | null, toStatus: string, meta?: any): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
       VALUES ($1, $2, $3, $4)`,
      [taskId, fromStatus, toStatus, meta ? JSON.stringify(meta) : null],
    );
  } catch {
    // Event recording failures must never block pipeline operations
  }
}

// ── Poller ────────────────────────────────────────────────────────────

let pollerRunning = false;

export function startPoller(): void {
  if (pollerRunning) return;
  pollerRunning = true;
  console.log(`[pipeline] Poller started (interval: ${POLL_INTERVAL}ms, max concurrent: ${MAX_CONCURRENT})`);
  setInterval(pollPendingTasks, POLL_INTERVAL);
}

async function pollPendingTasks(): Promise<void> {
  if (!pool) return;
  try {
    // Check concurrent running agents
    const { rows: running } = await pool.query(
      `SELECT count(*)::int as count FROM pipeline.tasks WHERE status IN ('queued', 'running')`,
    );
    if (running[0].count >= MAX_CONCURRENT) return;

    // Get next pending task
    const { rows: pending } = await pool.query(
      `SELECT id, description, task_type, target_repo, context_bundle
       FROM pipeline.tasks
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`,
    );
    if (pending.length === 0) return;

    const task = pending[0];
    await spawnAgent(task);
  } catch (err: any) {
    console.error('[pipeline] Poll error:', err.message);
  }
}

// ── Agent spawner ────────────────────────────────────────────────────

async function spawnAgent(task: any): Promise<void> {
  const agentId = `pipeline-${task.id.substring(0, 8)}`;
  await updateTaskStatus(task.id, 'queued', { agent_id: agentId });
  await pool.query(
    `UPDATE pipeline.tasks SET agent_id = $1 WHERE id = $2`,
    [agentId, task.id],
  );

  try {
    const prompt = buildPrompt(task.task_type, task.description);
    const contextStr = task.context_bundle ? JSON.stringify(task.context_bundle) : '';
    const fullPrompt = `${prompt}\n\n## Context\n${contextStr}`;

    const config = getTaskTypeConfig(task.task_type);
    await updateTaskStatus(task.id, 'running');

    const result = await submitToKlaus(fullPrompt, contextStr, 'normal');

    if (result && 'task_id' in result) {
      // Klaus accepted the task — it will run async
      await pool.query(
        `UPDATE pipeline.tasks SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{klaus_task_id}', $1)
         WHERE id = $2`,
        [JSON.stringify(result.task_id), task.id],
      );
    }
  } catch (err: any) {
    await updateTaskStatus(task.id, 'failed', { error: err.message });
    await pool.query(
      `UPDATE pipeline.tasks SET failure_reason = $1 WHERE id = $2`,
      [err.message, task.id],
    );
  }
}
