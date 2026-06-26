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
// Deterministic graph-ingest tasks are allowed at EVERY trust tier — they are
// zero-LLM, produce no PR, and only read source + write the trace graph. Only
// `ingest-tests` remains a task: it runs the project's suite, so it needs a
// runner / CI sandbox. specs/adrs project via the CI-driven spec-trace trigger
// (no task) — see ADR-023.
const GRAPH_INGEST = ["ingest-tests"];

/**
 * Whether a task type is a deterministic graph-ingest task (zero-LLM, no Issue,
 * no PR). This is the drift-proof identity used by the worker's dispatch guard:
 * the YAML `execution_mode: graph-ingest` flag can silently vanish under a stale
 * `/config/task-types.yaml` mount, so the worker must not rely on config alone to
 * keep these tasks off the LLM ladder (which would mint stray GitHub Issues).
 */
export function isGraphIngestTaskType(taskType: string): boolean {
  return GRAPH_INGEST.includes(taskType);
}
// Feature planning + finalize produce only analysis and a spec-doc PR (no code),
// so they are allowed from the docs tier up (ADR-027 / specs/7-feature-planning).
const FEATURE_PLANNING = ["feature-planning", "feature-finalize"];
const TRUST_LEVELS: Record<string, string[]> = {
  docs: ["gap-fill", "runbook", ...FEATURE_PLANNING, ...GRAPH_INGEST],
  tests: ["gap-fill", "runbook", "review", ...FEATURE_PLANNING, ...GRAPH_INGEST],
  implementation: ["gap-fill", "runbook", "review", "implementation", "feature-request", "general", ...FEATURE_PLANNING, ...GRAPH_INGEST],
  full: ["gap-fill", "runbook", "review", "implementation", "feature-request", "general", "onboard", ...FEATURE_PLANNING, ...GRAPH_INGEST],
};

export interface CreateTaskInput {
  description: string;
  taskType?: string;
  /** Already resolved by the caller (mcp applies getDefaultRepo). */
  targetRepo?: string;
  createdBy?: string;
  contextBundle?: any;
  priority?: string;
  taskGroupId?: string;
  contextRefs?: { fact_ids: string[]; memory_ids: string[] };
}

export async function createTask(pool: PgPool, input: CreateTaskInput): Promise<any> {
  const taskType = input.taskType ?? "general";
  const repo = input.targetRepo;
  const createdBy = input.createdBy ?? "ui";
  if (input.description.length > 10000) throw new Error("Description too long (max 10000 chars)");

  if (repo) {
    try {
      const { rows: repoRows } = await pool.query(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
      if (repoRows.length > 0) {
        const settings = repoRows[0].settings || {};
        const trustLevel = settings.trust?.level;
        if (trustLevel && TRUST_LEVELS[trustLevel]) {
          const allowed = TRUST_LEVELS[trustLevel];
          if (!allowed.includes(taskType)) {
            throw new Error(`Task type "${taskType}" not allowed at trust level "${trustLevel}" for ${repo}. Allowed: ${allowed.join(", ")}`);
          }
        }
      }
    } catch (err: any) {
      if (err.message.includes("not allowed at trust level")) throw err;
      // Non-trust errors are non-fatal
    }
  }

  const resolvedPriority = input.priority === "immediate" ? "immediate" : "normal";
  const contextJson = input.contextBundle ? JSON.stringify(input.contextBundle) : null;
  let rows: any[];
  if (input.taskGroupId) {
    const result = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority, task_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, priority, created_at`,
      [input.description, taskType, repo, createdBy, contextJson, resolvedPriority, input.taskGroupId],
    );
    rows = result.rows;
  } else {
    const result = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, priority, created_at`,
      [input.description, taskType, repo, createdBy, contextJson, resolvedPriority],
    );
    rows = result.rows;
  }
  const task = rows[0];
  if (input.contextRefs && (input.contextRefs.fact_ids.length > 0 || input.contextRefs.memory_ids.length > 0)) {
    await pool
      .query(`UPDATE pipeline.tasks SET context_refs = $1 WHERE id = $2`, [JSON.stringify(input.contextRefs), task.id])
      .catch(() => {});
  }
  await recordEvent(pool, task.id, null, "pending", { created_by: createdBy, priority: resolvedPriority });
  return { task_id: task.id, task_type: taskType, status: task.status, priority: task.priority, created_at: task.created_at };
}

export async function retryTask(pool: PgPool, taskId: string): Promise<any> {
  const task = await getTask(pool, taskId);
  if (!task) throw new Error("Task not found");
  if (task.status !== "failed" && task.status !== "needs-human-help") {
    throw new Error(`Cannot retry task in ${task.status} state (must be failed or needs-human-help)`);
  }
  const result = await createTask(pool, {
    description: task.description,
    taskType: task.task_type,
    targetRepo: task.target_repo,
    createdBy: `retry:${task.created_by}`,
    contextBundle: { ...(task.context_bundle || {}), retry_of: taskId },
  });
  await updateTaskStatus(pool, taskId, "retried", { retried_as: result.task_id });
  return { task_id: result.task_id, status: result.status, retry_of: taskId };
}

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
