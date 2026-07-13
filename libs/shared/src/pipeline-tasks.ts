import { enforceTrue } from "./lib/enforce.js";
import type { PgPool } from "./memory-store.js";

/**
 * Pipeline-task CRUD over the pipeline.tasks / pipeline.task_events tables.
 * Relocated from mcp-server/src/pipeline.ts so the SQL lives once — mcp's
 * pipeline.ts re-exports these (and the agent's inline task-status SQL can adopt
 * them too). Pool-based (not the repo-bound facade) because these are
 * task-id-keyed, cross-repo operations. Behavior is byte-for-byte the original.
 */

/** Trust level → allowed task types. The createTask gate reads
 *  lore.repos.settings.trust.level. Relocated from mcp's pipeline.ts. */
// Feature planning + finalize produce only analysis and a spec-doc PR (no code),
// so they are allowed from the docs tier up (ADR-027 / specs/7-feature-planning).
const FEATURE_PLANNING = ["feature-planning", "feature-finalize"];
const TRUST_LEVELS: Record<string, string[]> = {
  docs: ["gap-fill", "runbook", ...FEATURE_PLANNING],
  tests: ["gap-fill", "runbook", "review", ...FEATURE_PLANNING],
  implementation: [
    "gap-fill",
    "runbook",
    "review",
    "implementation",
    "feature-request",
    "general",
    ...FEATURE_PLANNING,
  ],
  full: [
    "gap-fill",
    "runbook",
    "review",
    "implementation",
    "feature-request",
    "general",
    "onboard",
    ...FEATURE_PLANNING,
  ],
};

export interface CreateTaskInput {
  description: string;
  taskType?: string;
  /** Already resolved by the caller (mcp applies getDefaultRepo). */
  targetRepo?: string;
  createdBy?: string;
  contextBundle?: Record<string, unknown>;
  priority?: string;
  taskGroupId?: string;
  contextRefs?: { fact_ids: string[]; memory_ids: string[] };
}

export interface CreatedTask {
  task_id: string;
  task_type: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface RetriedTask {
  task_id: string;
  status: string;
  retry_of: string;
}

/** A pipeline.tasks row. `SELECT *` returns more columns than the named ones. */
export interface PipelineTaskRow {
  id: string;
  description: string;
  task_type: string;
  target_repo: string | null;
  status: string;
  created_by: string;
  context_bundle: Record<string, unknown> | null;
  priority?: string;
  created_at?: string;
  [column: string]: unknown;
}

export interface TaskListRow {
  id: string;
  description: string;
  task_type: string;
  status: string;
  target_repo: string | null;
  agent_id: string | null;
  pr_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function createTask(
  pool: PgPool,
  input: CreateTaskInput,
): Promise<CreatedTask> {
  const taskType = input.taskType ?? "general";
  const repo = input.targetRepo;
  const createdBy = input.createdBy ?? "ui";

  enforceTrue(
    input.description.length <= 10000,
    Error,
    "Description too long (max 10000 chars)",
  );

  if (repo) {
    try {
      const { rows: repoRows } = await pool.query(
        `SELECT settings FROM lore.repos WHERE full_name = $1`,
        [repo],
      );

      if (repoRows.length > 0) {
        const settings = (repoRows[0].settings as {
          trust?: { level?: string };
        }) || { trust: undefined };
        const trustLevel = settings.trust?.level;

        if (trustLevel && TRUST_LEVELS[trustLevel]) {
          const allowed = TRUST_LEVELS[trustLevel];

          enforceTrue(
            allowed.includes(taskType),
            Error,
            `Task type "${taskType}" not allowed at trust level "${trustLevel}" for ${repo}. Allowed: ${allowed.join(", ")}`,
          );
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("not allowed at trust level")
      ) {
        throw err;
      }
      // Non-trust errors are non-fatal
    }
  }

  const resolvedPriority =
    input.priority === "immediate" ? "immediate" : "normal";
  const contextJson = input.contextBundle
    ? JSON.stringify(input.contextBundle)
    : null;
  let rows: Array<{
    id: string;
    status: string;
    priority: string;
    created_at: string;
  }>;

  if (input.taskGroupId) {
    const result = await pool.query<(typeof rows)[number]>(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority, task_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, priority, created_at`,
      [
        input.description,
        taskType,
        repo,
        createdBy,
        contextJson,
        resolvedPriority,
        input.taskGroupId,
      ],
    );

    rows = result.rows;
  } else {
    const result = await pool.query<(typeof rows)[number]>(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, priority, created_at`,
      [
        input.description,
        taskType,
        repo,
        createdBy,
        contextJson,
        resolvedPriority,
      ],
    );

    rows = result.rows;
  }
  const task = rows[0];

  if (
    input.contextRefs &&
    (input.contextRefs.fact_ids.length > 0 ||
      input.contextRefs.memory_ids.length > 0)
  ) {
    await pool
      .query(`UPDATE pipeline.tasks SET context_refs = $1 WHERE id = $2`, [
        JSON.stringify(input.contextRefs),
        task.id,
      ])
      .catch(() => {});
  }
  await recordEvent(pool, task.id, null, "pending", {
    created_by: createdBy,
    priority: resolvedPriority,
  });

  return {
    task_id: task.id,
    task_type: taskType,
    status: task.status,
    priority: task.priority,
    created_at: task.created_at,
  };
}

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
  const result = await createTask(pool, {
    description: task.description,
    taskType: task.task_type,
    targetRepo: task.target_repo ?? undefined,
    createdBy: `retry:${task.created_by}`,
    contextBundle: { ...(task.context_bundle || {}), retry_of: taskId },
  });

  await updateTaskStatus(pool, taskId, "retried", {
    retried_as: result.task_id,
  });

  return { task_id: result.task_id, status: result.status, retry_of: taskId };
}

export async function getTask(
  pool: PgPool,
  taskId: string,
): Promise<(PipelineTaskRow & { events: Record<string, unknown>[] }) | null> {
  const { rows: tasks } = await pool.query<PipelineTaskRow>(
    `SELECT * FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  if (tasks.length === 0) {
    return null;
  }
  const { rows: events } = await pool.query(
    `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
    [taskId],
  );

  return { ...tasks[0], events };
}

export async function listTasks(
  pool: PgPool,
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ tasks: TaskListRow[]; total: number }> {
  const where = status ? "WHERE status = $1" : "";
  const params: unknown[] = status ? [status] : [];
  const limitIdx = params.push(limit);
  const offsetIdx = params.push(offset);
  const { rows } = await pool.query<TaskListRow>(
    `SELECT id, description, task_type, status, target_repo, agent_id, pr_url, created_by, created_at, updated_at
     FROM pipeline.tasks ${where}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int as total FROM pipeline.tasks ${where}`,
    status ? [status] : [],
  );

  return { tasks: rows, total: countRows[0].total as number };
}

/**
 * Columns setTaskStatus may write alongside `status` (allowlisted to prevent SQL
 * injection via dynamic keys). Superset of what the agent's setStatus needed.
 */
const ALLOWED_TASK_COLUMNS = new Set([
  "pr_url",
  "pr_number",
  "target_branch",
  "failure_reason",
  "agent_id",
  "log_url",
  "claimed_by",
  "claimed_at",
  "issue_number",
  "issue_url",
  "review_iteration",
  "actor",
  "priority",
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
    if (!ALLOWED_TASK_COLUMNS.has(key)) {
      continue;
    }
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  params.push(taskId);
  await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    params,
  );
}

/**
 * Compare-and-set status flip: only updates when the row is still in
 * `expectedStatus`, returning true iff this caller won the race. The guard
 * (`AND status = …`) is what the inline Floor writes carried to avoid
 * double-processing; `setTaskStatus` (no guard) cannot replace those.
 */
export async function setTaskStatusIf(
  pool: PgPool,
  taskId: string,
  expectedStatus: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const setClauses = ["status = $1", "updated_at = now()"];
  const params: unknown[] = [status];
  let idx = 2;

  for (const [key, value] of Object.entries(extra)) {
    if (!ALLOWED_TASK_COLUMNS.has(key)) {
      continue;
    }
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  const idIdx = idx;

  params.push(taskId);
  const expectedIdx = idx + 1;

  params.push(expectedStatus);
  const { rows } = await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idIdx} AND status = $${expectedIdx} RETURNING id`,
    params,
  );

  return rows.length > 0;
}

export async function recordEvent(
  pool: PgPool,
  taskId: string,
  fromStatus: string | null,
  toStatus: string | null,
  meta?: Record<string, unknown>,
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
export async function updateTaskStatus(
  pool: PgPool,
  taskId: string,
  newStatus: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT status FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  if (rows.length === 0) {
    return;
  }
  const oldStatus = rows[0].status as string;

  await setTaskStatus(pool, taskId, newStatus);
  await recordEvent(pool, taskId, oldStatus, newStatus, meta);
}

export async function cancelTask(
  pool: PgPool,
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    !["merged", "failed", "cancelled"].includes(task.status),
    Error,
    `Cannot cancel task in ${task.status} state`,
  );
  await updateTaskStatus(pool, taskId, "cancelled", { cancelled_by: "user" });

  return { task_id: taskId, status: "cancelled" };
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
