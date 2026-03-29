/**
 * Core pipeline module.
 *
 * Provides task CRUD, status-event recording, a periodic poller that
 * picks up pending tasks, and an agent spawner that delegates work to
 * Klaus. Uses the same pool-injection pattern as memory.ts.
 */

import { resolveAgentId } from './agent-id.js';
import { getTaskTypeConfig, buildPrompt, getDefaultRepo, loadTaskTypes } from './pipeline-config.js';
import { submitTask as submitToKlaus, getTaskStatus as getKlausStatus, getTaskResult as getKlausResult, isKlausError } from './klaus-client.js';
import { buildContextBundle } from './context-bundle.js';
import { createBranch, commitFile, createPR, isConfigured as isGitHubConfigured } from './pipeline-github.js';

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
      // Start monitoring the agent for completion/failure
      monitorAgent(task.id, result.task_id, task.task_type);
    }
  } catch (err: any) {
    await updateTaskStatus(task.id, 'failed', { error: err.message });
    await pool.query(
      `UPDATE pipeline.tasks SET failure_reason = $1 WHERE id = $2`,
      [err.message, task.id],
    );
  }
}

// ── Agent completion (T014) ─────────────────────────────────────────

export async function handleAgentCompletion(taskId: string, output: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;

  const slug = task.description.substring(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const branchName = `agent/${taskId.substring(0, 8)}/${slug}`;
  const repo = task.target_repo;

  try {
    await createBranch(repo, branchName);

    // Determine output file path based on task type
    const filePath = getOutputPath(task.task_type, slug);
    await commitFile(repo, branchName, filePath, output, `agent: ${task.description.substring(0, 50)}`);

    const prBody = `## Agent-Generated PR\n\n**Task:** ${task.description}\n**Type:** ${task.task_type}\n**Agent:** ${task.agent_id}\n\n---\n\n${output.substring(0, 500)}...`;
    const { url, number } = await createPR(repo, branchName, `agent: ${task.description.substring(0, 60)}`, prBody);

    await pool.query(
      `UPDATE pipeline.tasks SET pr_url = $1, pr_number = $2, target_branch = $3 WHERE id = $4`,
      [url, number, branchName, taskId],
    );
    await updateTaskStatus(taskId, 'pr-created', { pr_url: url, pr_number: number });
  } catch (err: any) {
    await updateTaskStatus(taskId, 'failed', { error: `PR creation failed: ${err.message}` });
    await pool.query(
      `UPDATE pipeline.tasks SET failure_reason = $1 WHERE id = $2`,
      [`PR creation failed: ${err.message}`, taskId],
    );
  }
}

function getOutputPath(taskType: string, slug: string): string {
  switch (taskType) {
    case 'runbook': return `runbooks/${slug}.md`;
    case 'gap-fill': return `teams/platform/${slug}.md`;
    case 'implementation': return `src/${slug}.ts`;
    default: return `output/${slug}.md`;
  }
}

// ── Agent monitoring (T015) ─────────────────────────────────────────

async function monitorAgent(taskId: string, klausTaskId: string, taskType: string): Promise<void> {
  const checkInterval = setInterval(async () => {
    try {
      const status = await getKlausStatus(klausTaskId);
      if (isKlausError(status)) return; // transient error, retry next interval

      if (status.status === 'completed') {
        clearInterval(checkInterval);
        const result = await getKlausResult(klausTaskId);
        const output = (!isKlausError(result) && result.output) ? result.output : '';
        await handleAgentCompletion(taskId, output);
      } else if (status.status === 'failed') {
        clearInterval(checkInterval);
        await handleAgentFailure(taskId, status.failure_reason || 'Agent failed');
      }
    } catch {
      // Swallow transient errors; next interval will retry
    }
  }, 30000);

  // Safety timeout based on task-type configuration
  const config = getTaskTypeConfig(taskType);
  const timeout = (config?.timeout_minutes || 30) * 60 * 1000;
  setTimeout(() => {
    clearInterval(checkInterval);
    handleAgentFailure(taskId, 'Task timed out').catch(() => {});
  }, timeout);
}

// ── Agent failure (T016) ────────────────────────────────────────────

export async function handleAgentFailure(taskId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE pipeline.tasks SET failure_reason = $1 WHERE id = $2`,
    [reason, taskId],
  );
  await updateTaskStatus(taskId, 'failed', { error: reason });
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
    await pool.query(
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
      // Re-trigger implementation agent with review feedback
      await createTask(
        `Address review feedback on PR: ${comments.substring(0, 200)}`,
        task.task_type,
        task.target_repo,
        'review-agent',
        { branch: task.target_branch, review_comments: comments },
      );
      await updateTaskStatus(taskId, 'review', { review_result: 'changes-requested', iteration });
    }
  }
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

export function startMergeChecker(): void {
  setInterval(async () => {
    if (!pool) return;
    try {
      const { rows } = await pool.query(
        `SELECT id, pr_url, pr_number, target_repo FROM pipeline.tasks
         WHERE status = 'pr-created' AND pr_number IS NOT NULL`,
      );
      for (const task of rows) {
        try {
          if (!isGitHubConfigured()) continue;
          const { Octokit } = await import('octokit');
          // Simplified check — full implementation requires GitHub App auth per-repo.
          // For now merge detection is manual via mark_task_merged tool.
        } catch {}
      }
    } catch {}
  }, 60000);
}
