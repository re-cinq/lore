import type { PgPool } from "./memory-store.js";
import type { PipelineTask } from "./types.js";

/** Pipeline-task CRUD over pipeline.tasks/pipeline.task_events; relocated from mcp-server/src/pipeline.ts so the SQL lives once, pool-based since these are cross-repo. */

// Trust-level task-type gating lives in pipeline-task-trust.ts, re-exported for import-path back-compat.
export {
  TRUST_LEVELS,
  enforceTrustAllowsTaskType,
} from "./pipeline-task-trust.js";

// Core CRUD (create/get/record-event/update-status) lives in pipeline-task-core.ts, re-exported for import-path back-compat.
export {
  createTask,
  getTask,
  recordEvent,
  updateTaskStatus,
  type CreateTaskInput,
  type CreatedTask,
  type RetriedTask,
  type PipelineTaskRow,
  type StatusTransition,
} from "./pipeline-task-core.js";

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

// Status-column mutation (ALLOWED_TASK_COLUMNS/setTaskStatus/setTaskStatusIf) lives in pipeline-task-status.ts, re-exported for import-path back-compat.
export {
  ALLOWED_TASK_COLUMNS,
  setTaskStatus,
  setTaskStatusIf,
} from "./pipeline-task-status.js";

// Task lifecycle actions (retry/cancel/escalate/revise/mark-merged) live in pipeline-task-actions.ts, re-exported for import-path back-compat.
export {
  retryTask,
  cancelTask,
  escalateTask,
  reviseTask,
  markTaskMerged,
} from "./pipeline-task-actions.js";
