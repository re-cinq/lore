import { enforceTrue } from "./lib/enforce.js";
import type { PgPool } from "./memory-store.js";
import { selectList } from "./lib/row.js";
import { PIPELINE_TASK_COLUMNS } from "./models/pipeline-task.js";
import { TASK_EVENT_COLUMNS } from "./models/task-event.js";
import type { PipelineTask } from "./types.js";

/** Pipeline-task CRUD over pipeline.tasks/pipeline.task_events; relocated from mcp-server/src/pipeline.ts so the SQL lives once, pool-based since these are cross-repo. */

// Trust-level task-type gating lives in pipeline-task-trust.ts, re-exported for import-path back-compat.
export {
  TRUST_LEVELS,
  enforceTrustAllowsTaskType,
} from "./pipeline-task-trust.js";
import { enforceRepoTrustForTaskType } from "./pipeline-task-trust.js";

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

// The createTask API response body — task_id renames the row's id; not a column restatement.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface CreatedTask {
  task_id: string;
  task_type: string;
  status: string;
  priority: string;
  created_at: string;
}

// The retryTask API response body — same renamed-field shape as CreatedTask.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface RetriedTask {
  task_id: string;
  status: string;
  retry_of: string;
}

/** The pipeline.tasks columns `getTask` actually reads, plus whatever `SELECT *` elsewhere adds. */
export type PipelineTaskRow = Pick<
  PipelineTask,
  | "id"
  | "description"
  | "task_type"
  | "target_repo"
  | "status"
  | "created_by"
  | "context_bundle"
  | "priority"
  | "created_at"
> & { [column: string]: unknown };

/** The 10-column projection `listTasks` selects, named from the wire type. */
export type TaskListRow = Pick<
  PipelineTask,
  | "id"
  | "description"
  | "task_type"
  | "status"
  | "target_repo"
  | "agent_id"
  | "pr_url"
  | "created_by"
  | "created_at"
  | "updated_at"
>;

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
// Status-column mutation (ALLOWED_TASK_COLUMNS/setTaskStatus/setTaskStatusIf) lives in pipeline-task-status.ts, re-exported for import-path back-compat.
export {
  ALLOWED_TASK_COLUMNS,
  setTaskStatus,
  setTaskStatusIf,
} from "./pipeline-task-status.js";
import { setTaskStatus } from "./pipeline-task-status.js";

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

// Task lifecycle actions (retry/cancel/escalate/revise/mark-merged) live in pipeline-task-actions.ts, re-exported for import-path back-compat.
export {
  retryTask,
  cancelTask,
  escalateTask,
  reviseTask,
  markTaskMerged,
} from "./pipeline-task-actions.js";
