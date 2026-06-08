import type { PgPool } from "./memory-store.js";

/**
 * Pipeline-task CRUD over the pipeline.tasks / pipeline.task_events tables.
 * Relocated from mcp-server/src/pipeline.ts so the SQL lives once — mcp's
 * pipeline.ts re-exports these (and the agent's inline task-status SQL can adopt
 * them too). Pool-based (not the repo-bound facade) because these are
 * task-id-keyed, cross-repo operations. Behavior is byte-for-byte the original.
 */

export async function getTask(pool: PgPool, taskId: string): Promise<any> {
  const { rows: tasks } = await pool.query(`SELECT * FROM pipeline.tasks WHERE id = $1`, [taskId]);
  if (tasks.length === 0) return null;
  const { rows: events } = await pool.query(
    `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );
  return { ...tasks[0], events };
}

export async function listTasks(pool: PgPool, status?: string, limit = 50): Promise<any> {
  const where = status ? "WHERE status = $1" : "";
  const params = status ? [status, limit] : [limit];
  const { rows } = await pool.query(
    `SELECT id, description, task_type, status, target_repo, agent_id, pr_url, created_by, created_at, updated_at
     FROM pipeline.tasks ${where}
     ORDER BY created_at DESC
     LIMIT $${status ? "2" : "1"}`,
    params,
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int as total FROM pipeline.tasks ${where}`,
    status ? [status] : [],
  );
  return { tasks: rows, total: countRows[0].total };
}

/**
 * Columns setTaskStatus may write alongside `status` (allowlisted to prevent SQL
 * injection via dynamic keys). Superset of what the agent's setStatus needed.
 */
const ALLOWED_TASK_COLUMNS = new Set([
  "pr_url", "pr_number", "target_branch", "failure_reason", "agent_id",
  "log_url", "claimed_by", "claimed_at", "issue_number", "issue_url",
  "review_iteration", "actor", "priority",
]);

/**
 * Update a task's status (+ updated_at) and any allowlisted extra columns.
 * Does NOT record an event — callers that need the audit event call recordEvent
 * (or use updateTaskStatus, which composes both). This is the agent's setStatus.
 */
export async function setTaskStatus(
  pool: PgPool,
  taskId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const setClauses = ["status = $1", "updated_at = now()"];
  const params: unknown[] = [status];
  let idx = 2;
  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_TASK_COLUMNS.has(key)) continue;
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  params.push(taskId);
  await pool.query(`UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idx}`, params);
}

export async function recordEvent(
  pool: PgPool,
  taskId: string,
  fromStatus: string | null,
  toStatus: string | null,
  meta?: any,
): Promise<void> {
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

/** Combined: read the old status, set the new one, and record the transition event. */
export async function updateTaskStatus(pool: PgPool, taskId: string, newStatus: string, meta?: any): Promise<void> {
  const { rows } = await pool.query(`SELECT status FROM pipeline.tasks WHERE id = $1`, [taskId]);
  if (rows.length === 0) return;
  const oldStatus = rows[0].status;
  await setTaskStatus(pool, taskId, newStatus);
  await recordEvent(pool, taskId, oldStatus, newStatus, meta);
}

export async function cancelTask(pool: PgPool, taskId: string): Promise<any> {
  const task = await getTask(pool, taskId);
  if (!task) throw new Error("Task not found");
  if (["merged", "failed", "cancelled"].includes(task.status)) {
    throw new Error(`Cannot cancel task in ${task.status} state`);
  }
  await updateTaskStatus(pool, taskId, "cancelled", { cancelled_by: "user" });
  return { task_id: taskId, status: "cancelled" };
}

export async function markTaskMerged(pool: PgPool, taskId: string): Promise<any> {
  const task = await getTask(pool, taskId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "pr-created" && task.status !== "review") {
    throw new Error(`Cannot mark task as merged from ${task.status} state (expected pr-created or review)`);
  }
  await updateTaskStatus(pool, taskId, "merged", { merged_by: "manual" });
  return { task_id: taskId, status: "merged" };
}
