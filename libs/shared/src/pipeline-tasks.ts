import { enforceTrue } from "./lib/enforce.js";
import type { PgPool } from "./memory-store.js";
import { selectList } from "./lib/row.js";
import { PIPELINE_TASK_COLUMNS } from "./models/pipeline-task.js";
import { TASK_EVENT_COLUMNS } from "./models/task-event.js";

/** Pipeline-task CRUD over pipeline.tasks/pipeline.task_events; relocated from mcp-server/src/pipeline.ts so the SQL lives once, pool-based since these are cross-repo. */

/** Trust level → allowed task types (createTask gate reads lore.repos.settings.trust.level). */
// Feature planning is allowed from the docs tier up (ADR-027 / specs/7-feature-planning) — analysis + a spec-doc PR only, no code.
const FEATURE_PLANNING = ["feature-planning"];

// Onboarding is allowed at every tier (docs-only PR, deduped by onboard-guard.ts) — restricting to `full` 500s reonboard on auto-demoted repos.
export const TRUST_LEVELS: Record<string, string[]> = {
  docs: ["gap-fill", "runbook", "onboard", ...FEATURE_PLANNING],
  tests: ["gap-fill", "runbook", "onboard", "review", ...FEATURE_PLANNING],
  implementation: [
    "gap-fill",
    "runbook",
    "onboard",
    "review",
    "implementation",
    "implementation-loop",
    "feature-request",
    "general",
    ...FEATURE_PLANNING,
  ],
  full: [
    "gap-fill",
    "runbook",
    "review",
    "implementation",
    "implementation-loop",
    "feature-request",
    "general",
    "onboard",
    ...FEATURE_PLANNING,
  ],
};

/** Throws when trust level forbids the task type; a missing/unknown level passes (back-compat). Exported so the in-memory task store applies the same gate as {@link createTask}. */
export function enforceTrustAllowsTaskType(
  trustLevel: string | undefined,
  taskType: string,
  repo: string,
): void {
  if (!trustLevel || !TRUST_LEVELS[trustLevel]) {
    return;
  }
  const allowed = TRUST_LEVELS[trustLevel];

  enforceTrue(
    allowed.includes(taskType),
    Error,
    `Task type "${taskType}" not allowed at trust level "${trustLevel}" for ${repo}. Allowed: ${allowed.join(", ")}`,
  );
}

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

async function trustLevelForRepo(
  pool: PgPool,
  repo: string,
): Promise<string | undefined> {
  const { rows: repoRows } = await pool.query(
    `SELECT settings FROM lore.repos WHERE full_name = $1`,
    [repo],
  );

  if (repoRows.length === 0) {
    return undefined;
  }
  const settings = (repoRows[0].settings as {
    trust?: { level?: string };
  }) || { trust: undefined };

  return settings.trust?.level;
}

function isTrustViolation(err: unknown): err is Error {
  return (
    err instanceof Error && err.message.includes("not allowed at trust level")
  );
}

/** Throw when trust level forbids the task type; any other failure (missing row, read error) is non-fatal. */
async function enforceRepoTrustForTaskType(
  pool: PgPool,
  repo: string,
  taskType: string,
): Promise<void> {
  try {
    const trustLevel = await trustLevelForRepo(pool, repo);

    enforceTrustAllowsTaskType(trustLevel, taskType, repo);
  } catch (err) {
    if (isTrustViolation(err)) {
      throw err;
    }
    // Non-trust errors are non-fatal
  }
}

function resolvePriority(priority: string | undefined): string {
  return priority === "immediate" ? "immediate" : "normal";
}

function buildInsertTaskSql(hasGroup: boolean): string {
  return hasGroup
    ? `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority, task_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, priority, created_at`
    : `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status, priority, created_at`;
}

interface InsertTaskParams {
  description: string;
  taskType: string;
  repo: string | undefined;
  createdBy: string;
  contextJson: string | null;
  priority: string;
  taskGroupId?: string;
}

function buildInsertTaskParams(p: InsertTaskParams): unknown[] {
  return [
    p.description,
    p.taskType,
    p.repo,
    p.createdBy,
    p.contextJson,
    p.priority,
    ...(p.taskGroupId ? [p.taskGroupId] : []),
  ];
}

function hasContextRefs(refs: CreateTaskInput["contextRefs"]): boolean {
  return Boolean(
    refs && (refs.fact_ids.length > 0 || refs.memory_ids.length > 0),
  );
}

async function saveContextRefs(
  pool: PgPool,
  taskId: string,
  refs: CreateTaskInput["contextRefs"],
): Promise<void> {
  if (!hasContextRefs(refs)) {
    return;
  }
  await pool
    .query(`UPDATE pipeline.tasks SET context_refs = $1 WHERE id = $2`, [
      JSON.stringify(refs),
      taskId,
    ])
    .catch(() => {});
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
    await enforceRepoTrustForTaskType(pool, repo, taskType);
  }

  const resolvedPriority = resolvePriority(input.priority);
  const contextJson = input.contextBundle
    ? JSON.stringify(input.contextBundle)
    : null;
  const insertSql = buildInsertTaskSql(Boolean(input.taskGroupId));
  const insertParams = buildInsertTaskParams({
    description: input.description,
    taskType,
    repo,
    createdBy,
    contextJson,
    priority: resolvedPriority,
    taskGroupId: input.taskGroupId,
  });
  const result = await pool.query<{
    id: string;
    status: string;
    priority: string;
    created_at: string;
  }>(insertSql, insertParams);
  const task = result.rows[0];

  await saveContextRefs(pool, task.id, input.contextRefs);
  await recordEvent(
    pool,
    task.id,
    { from: null, to: "pending" },
    {
      created_by: createdBy,
      priority: resolvedPriority,
    },
  );

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
  // The MODEL's columns, not `SELECT *` — the read is a published contract, so a dropped column fails here instead of vanishing silently.
  const { rows: tasks } = await pool.query<PipelineTaskRow>(
    `SELECT ${selectList(PIPELINE_TASK_COLUMNS)} FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  if (tasks.length === 0) {
    return null;
  }
  const { rows: events } = await pool.query(
    `SELECT ${selectList(TASK_EVENT_COLUMNS)}
       FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
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

/** Columns setTaskStatus may write alongside `status` (allowlisted against SQL injection via dynamic keys); silently skips unknown keys, unlike setColumns which throws. */
export const ALLOWED_TASK_COLUMNS = new Set([
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

/** Updates status + updated_at + allowlisted extra columns; does NOT record an event (use updateTaskStatus for that, or call recordEvent yourself). */
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

/** Compare-and-set status flip — updates only when the row is still `expectedStatus`, returning true iff this caller won the race (guards against double-processing). */
export async function setTaskStatusIf(
  pool: PgPool,
  taskId: string,
  { expected: expectedStatus, status }: { expected: string; status: string },
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

export interface StatusTransition {
  from: string | null;
  to: string | null;
}

export async function recordEvent(
  pool: PgPool,
  taskId: string,
  { from: fromStatus, to: toStatus }: StatusTransition,
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
  await recordEvent(pool, taskId, { from: oldStatus, to: newStatus }, meta);
}

export async function cancelTask(
  pool: PgPool,
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    // `completed` belongs here: its absence made the same click answer 400 in the web UI and 200 through this seam.
    !["completed", "merged", "failed", "cancelled"].includes(task.status),
    Error,
    `Cannot cancel task in ${task.status} state`,
  );
  await updateTaskStatus(pool, taskId, "cancelled", { cancelled_by: "user" });

  return { task_id: taskId, status: "cancelled" };
}

/** Run-now: jumps a queued task to the front of the poll order; refuses (rather than no-op) an unknown id or a task already past `pending`, and logs the escalation to pipeline.task_events. */
export async function escalateTask(
  pool: PgPool,
  taskId: string,
): Promise<{ task_id: string; priority: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(
    task.status === "pending",
    Error,
    `Can only escalate pending tasks, current status: ${task.status}`,
  );
  await pool.query(
    `UPDATE pipeline.tasks SET priority = 'immediate', updated_at = now() WHERE id = $1`,
    [taskId],
  );
  await recordEvent(
    pool,
    taskId,
    { from: task.status, to: task.status },
    {
      action: "run-now",
      previous_priority: task.priority,
    },
  );

  return { task_id: taskId, priority: "immediate" };
}

/** Queues a revision of a task from human feedback: a follow-up task on the SAME branch/PR at immediate priority, with the parent moved to `revision-requested`. */
export async function reviseTask(
  pool: PgPool,
  taskId: string,
  feedback: string,
): Promise<{ task_id: string; revision_task_id: string }> {
  const task = await getTask(pool, taskId);

  enforceTrue(task, Error, "Task not found");
  enforceTrue(Boolean(feedback.trim()), Error, "Feedback is required");

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
     VALUES ($1, $2, $3, $4, $5, 'immediate') RETURNING id`,
    [
      `Revise based on feedback: ${feedback.substring(0, 200)}`,
      task.task_type === "feature-request"
        ? "feature-request"
        : "implementation",
      task.target_repo,
      "ui-feedback",
      JSON.stringify({
        parent_task_id: taskId,
        branch: task.target_branch,
        pr_number: task.pr_number,
        feedback,
      }),
    ],
  );
  const revisionTaskId = rows[0].id;

  await recordEvent(
    pool,
    taskId,
    { from: task.status, to: "revision-requested" },
    {
      feedback,
      revision_task_id: revisionTaskId,
    },
  );
  await pool.query(
    `UPDATE pipeline.tasks SET status = 'revision-requested', updated_at = now() WHERE id = $1`,
    [taskId],
  );

  return { task_id: taskId, revision_task_id: revisionTaskId };
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
