import type { PgPool } from "../../memory-store.js";
import type { PipelineTask } from "../../types.js";
import type {
  TaskQueueRepository,
  RecoverableTask,
  StaleTask,
  ReadySpecTask,
  SpecGroupCount,
} from "./task-queue-port.js";

/**
 * Postgres-backed {@link TaskQueueRepository}. The SQL is the org-wide
 * claim/sweep that used to live inline in the Floor worker, stale-task-check,
 * and spec-task-executor jobs, moved here verbatim (the only change: the dead
 * `status != 'running-local'` predicate is dropped from the worker claim — it
 * is unreachable once `status = 'pending'` holds).
 */
export class PgTaskQueue implements TaskQueueRepository {
  constructor(private readonly pool: PgPool) {}

  async claimNextPending(): Promise<PipelineTask | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM pipeline.tasks
        WHERE status = 'pending'
          AND (
            (priority = 'immediate')
            OR (created_at < now() - interval '30 seconds')
          )
        ORDER BY
          CASE WHEN priority = 'immediate' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1`,
    );
    return (rows[0] as PipelineTask) ?? null;
  }

  async findRecoverable(maxAgeMinutes = 30): Promise<RecoverableTask[]> {
    const { rows } = await this.pool.query(
      `SELECT id, task_type FROM pipeline.tasks
        WHERE status IN ('running', 'queued')
          AND updated_at < now() - ($1 || ' minutes')::interval`,
      [String(maxAgeMinutes)],
    );
    return rows as RecoverableTask[];
  }

  async findStaleRunning(thresholdHours: number): Promise<StaleTask[]> {
    const { rows } = await this.pool.query(
      `SELECT id,
              target_repo,
              task_type,
              created_at,
              issue_number,
              EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS age_hours
         FROM pipeline.tasks
        WHERE status = 'running'
          AND created_at < now() - ($1 || ' hours')::interval`,
      [String(thresholdHours)],
    );
    return rows as StaleTask[];
  }

  async findReadySpecTasks(): Promise<ReadySpecTask[]> {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.description, t.context_bundle, t.target_repo, t.task_group_id
         FROM pipeline.tasks t
        WHERE t.task_type = 'spec-task'
          AND t.status = 'pending'
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(t.context_bundle->'depends_on') AS dep_id
            WHERE NOT EXISTS (
              SELECT 1 FROM pipeline.tasks d
              WHERE d.target_repo = t.target_repo
                AND d.task_type = 'spec-task'
                AND d.context_bundle->>'spec_task_id' = dep_id
                AND d.context_bundle->>'spec_slug' = t.context_bundle->>'spec_slug'
                AND d.status IN ('completed', 'merged')
            )
          )
        ORDER BY t.context_bundle->>'spec_task_id'`,
    );
    return rows as ReadySpecTask[];
  }

  async countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]> {
    const { rows } = await this.pool.query(
      `SELECT task_group_id, COUNT(*) as cnt
         FROM pipeline.tasks
        WHERE task_type = 'spec-task'
          AND status IN ('running', 'queued')
          AND task_group_id IS NOT NULL
        GROUP BY task_group_id`,
    );
    return rows as SpecGroupCount[];
  }

  async claimSpecTask(id: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.tasks
          SET status = 'running', agent_id = 'spec-task-executor', updated_at = now()
        WHERE id = $1 AND status = 'pending'
      RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }
}
