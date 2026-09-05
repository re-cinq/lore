/** Core pipeline-task CRUD (create/read/record-event/update-status) — split out so pipeline-task-actions.ts (retry/cancel/escalate/revise/mark-merged) can depend on it without pipeline-tasks.ts importing back from pipeline-task-actions.ts. */

import { enforceTrue } from "./lib/enforce.js";
import type { PgPool } from "./memory-store.js";
import { selectList } from "./lib/row.js";
import { PIPELINE_TASK_COLUMNS } from "./models/pipeline-task.js";
import { TASK_EVENT_COLUMNS } from "./models/task-event.js";
import type { PipelineTask } from "./types.js";
import { enforceRepoTrustForTaskType } from "./pipeline-task-trust.js";
import { setTaskStatus } from "./pipeline-task-status.js";

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
