import { selectList } from "../../lib/row.js";
import { PIPELINE_TASK_COLUMNS } from "../../models/pipeline-task.js";
import type { PgPool } from "../../memory-store.js";
import type { PipelineTask } from "../../types.js";
import {
  createTask,
  retryTask,
  getTask,
  listTasks,
  setTaskStatus,
  setTaskStatusIf,
  updateTaskStatus,
  recordEvent,
  cancelTask,
  markTaskMerged,
  type CreateTaskInput,
  type CreatedTask,
  type RetriedTask,
} from "../../pipeline-tasks.js";
import {
  PENDING_STATUSES,
  RUNNING_STATUSES,
  EXECUTED_STATUSES,
  NEXT_STATUS,
  type TaskStorePort,
  type TaskAction,
  type TaskTransitionMeta,
  type TaskWithEvents,
  type TaskListResult,
  type FindOpenLikeInput,
  type DriftTaskRow,
  type FeatureTaskRow,
} from "./task-store-port.js";

/** TaskStorePort over pipeline.tasks; status updates via transition(). */

export class PgTaskStore implements TaskStorePort {
  constructor(private readonly pool: PgPool) {}

  pending(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, PENDING_STATUSES);
  }

  running(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, RUNNING_STATUSES);
  }

  executed(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, EXECUTED_STATUSES);
  }

  async getById(id: string): Promise<PipelineTask | null> {
    const { rows } = await this.pool.query<PipelineTask>(
      `SELECT ${selectList(PIPELINE_TASK_COLUMNS)} FROM pipeline.tasks WHERE id = $1`,
      [id],
    );

    return (rows.at(0) as PipelineTask | undefined) ?? null;
  }

  // ── ops delegating to the single-source pipeline-tasks functions ──

  create(input: CreateTaskInput): Promise<CreatedTask> {
    return createTask(this.pool, input);
  }

  retry(id: string): Promise<RetriedTask> {
    return retryTask(this.pool, id);
  }

  list(status?: string, limit?: number): Promise<TaskListResult> {
    return listTasks(this.pool, status, limit) as Promise<TaskListResult>;
  }

  getWithEvents(id: string): Promise<TaskWithEvents | null> {
    return getTask(this.pool, id) as Promise<TaskWithEvents | null>;
  }

  setStatus(
    id: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    return setTaskStatus(this.pool, id, status, extra);
  }

  setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<boolean> {
    return setTaskStatusIf(
      this.pool,
      id,
      { expected: expectedStatus, status },
      extra,
    );
  }

  updateStatus(
    id: string,
    status: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return updateTaskStatus(this.pool, id, status, meta);
  }

  recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return recordEvent(this.pool, id, { from: fromStatus, to: toStatus }, meta);
  }

  cancel(id: string): Promise<{ task_id: string; status: string }> {
    return cancelTask(this.pool, id);
  }

  markMerged(id: string): Promise<{ task_id: string; status: string }> {
    return markTaskMerged(this.pool, id);
  }

  async transition(
    id: string,
    action: TaskAction,
    meta?: TaskTransitionMeta,
  ): Promise<PipelineTask> {
    const claimedBy = action === "claim" ? (meta?.agentId ?? null) : null;
    const { rows } = await this.pool.query<PipelineTask>(
      `UPDATE pipeline.tasks
         SET status = $2,
             claimed_by = COALESCE($3, claimed_by),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, NEXT_STATUS[action], claimedBy],
    );

    return rows[0] as PipelineTask;
  }

  async findOpenLike(input: FindOpenLikeInput): Promise<PipelineTask[]> {
    const { rows } = await this.pool.query<PipelineTask>(
      `SELECT ${selectList(PIPELINE_TASK_COLUMNS)} FROM pipeline.tasks
       WHERE target_repo = $1 AND task_type = $2 AND description LIKE $3 AND status = ANY($4)`,
      [
        input.repo,
        input.taskType,
        `${input.descriptionPrefix}%`,
        [...input.statuses],
      ],
    );

    return rows as PipelineTask[];
  }

  async driftTasksForSpec(
    repo: string,
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]> {
    const { rows } = await this.pool.query<DriftTaskRow>(
      `SELECT status, created_at, issue_number FROM pipeline.tasks
       WHERE target_repo = $1 AND task_type = $2 AND context_bundle->>'spec_path' = $3`,
      [repo, taskType, specPath],
    );

    return rows as DriftTaskRow[];
  }

  async specTasksForFeature(
    repo: string,
    featureId: string,
  ): Promise<FeatureTaskRow[]> {
    const { rows } = await this.pool.query<FeatureTaskRow>(
      `SELECT description, status, context_bundle FROM pipeline.tasks
        WHERE target_repo = $1 AND task_type = 'spec-task'
          AND context_bundle->>'feature_id' = $2
        ORDER BY context_bundle->>'spec_task_id'`,
      [repo, featureId],
    );

    return rows as FeatureTaskRow[];
  }

  private async byStatus(
    repo: string,
    statuses: string[],
  ): Promise<PipelineTask[]> {
    const { rows } = await this.pool.query<PipelineTask>(
      `SELECT ${selectList(PIPELINE_TASK_COLUMNS)}
         FROM pipeline.tasks WHERE target_repo = $1 AND status = ANY($2) ORDER BY created_at DESC`,
      [repo, statuses],
    );

    return rows as PipelineTask[];
  }
}
