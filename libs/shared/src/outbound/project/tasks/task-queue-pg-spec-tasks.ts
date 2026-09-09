import type { PgPool } from "../../memory-store.js";
import { unblockedBy } from "./task-queue-port.js";
import type {
  ReadySpecTask,
  CompletedSpecTask,
  SpecGroupCount,
} from "./task-queue-port.js";

type SpecTaskContextFields = { context_bundle: Record<string, unknown> | null };

const specTaskIdOf = (task: SpecTaskContextFields): string | undefined =>
  task.context_bundle?.spec_task_id as string | undefined;
const specSlugOf = (task: SpecTaskContextFields): string | undefined =>
  task.context_bundle?.spec_slug as string | undefined;

const READY_SPEC_TASKS_HEAD = `SELECT t.id, t.description, t.context_bundle, t.target_repo, t.task_group_id
         FROM pipeline.tasks t
        WHERE t.task_type = 'spec-task'
          AND t.status = 'pending'`;

/** No dependency of the row is still un-done: the outer NOT EXISTS walks `depends_on`, the inner one looks for that dependency completed or merged within the same repo and spec slug. */
const DEPENDENCIES_SATISFIED = `AND NOT EXISTS (
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
          )`;

function readySpecTasksSql(repo?: string): string {
  const repoFilter = repo ? "AND t.target_repo = $1" : "";

  return `${READY_SPEC_TASKS_HEAD}
          ${repoFilter}
          ${DEPENDENCIES_SATISFIED}
        ORDER BY t.context_bundle->>'spec_task_id'`;
}

/** The spec-task DAG dispatch queries of {@link PgTaskQueue} — readiness (dependencies satisfied), per-group running counts, claim, and completion-unblocks-next. */
export class PgSpecTaskQueries {
  constructor(private readonly pool: PgPool) {}

  async findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]> {
    const { rows } = await this.pool.query<ReadySpecTask>(
      readySpecTasksSql(repo),
      repo ? [repo] : [],
    );

    return rows as ReadySpecTask[];
  }

  async countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]> {
    const { rows } = await this.pool.query<SpecGroupCount>(
      `SELECT task_group_id, COUNT(*) as cnt
         FROM pipeline.tasks
        WHERE task_type = 'spec-task'
          AND status IN ('running', 'queued')
          AND task_group_id IS NOT NULL
        GROUP BY task_group_id`,
    );

    return rows as SpecGroupCount[];
  }

  async countUnmergedInGroup(groupId: string): Promise<number> {
    const { rows } = await this.pool.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt
         FROM pipeline.tasks
        WHERE task_group_id = $1
          AND status <> 'merged'`,
      [groupId],
    );

    return Number(rows[0]?.cnt ?? 0);
  }

  async claimSpecTask(
    id: string,
    agentId = "spec-task-executor",
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.tasks
          SET status = 'running', agent_id = $2, updated_at = now()
        WHERE id = $1 AND status = 'pending'
      RETURNING id`,
      [id, agentId],
    );

    return rows.length > 0;
  }

  /** The row behind `id` when it is still running — completion is a no-op for a task in any other state. */
  private async runningSpecTask(id: string) {
    const { rows } = await this.pool.query<{
      context_bundle: Record<string, unknown> | null;
      target_repo: string;
      status: string;
    }>(
      `SELECT context_bundle, target_repo, status FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    const task = rows.at(0);

    return task?.status === "running" ? task : null;
  }

  private async markCompleted(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async completeSpecTask(id: string): Promise<CompletedSpecTask> {
    const task = await this.runningSpecTask(id);

    if (!task) {
      return { completed: false, unblocked: [] };
    }
    // eslint-disable-next-line re-lint/no-duplicate-code -- the SQL spec-task DAG claim; reading like the in-memory double is the double doing its job, and only one of the two can hold the transaction
    await this.markCompleted(id);

    const specTaskId = specTaskIdOf(task);
    const specSlug = specSlugOf(task);

    if (!specTaskId || !specSlug) {
      return { completed: true, unblocked: [] };
    }
    const ready = await this.findReadySpecTasks(task.target_repo);

    return {
      completed: true,
      unblocked: unblockedBy(ready, specSlug, specTaskId),
    };
  }

  async hasSpecTasksForSlug(repo: string, slug: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT id FROM pipeline.tasks
        WHERE task_type = 'spec-task'
          AND target_repo = $1
          AND context_bundle->>'spec_slug' = $2
        LIMIT 1`,
      [repo, slug],
    );

    return rows.length > 0;
  }
}
