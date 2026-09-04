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

/** The spec-task DAG dispatch queries of {@link PgTaskQueue} — readiness (dependencies satisfied), per-group running counts, claim, and completion-unblocks-next. */
export class PgSpecTaskQueries {
  constructor(private readonly pool: PgPool) {}

  async findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]> {
    const { rows } = await this.pool.query<ReadySpecTask>(
      `SELECT t.id, t.description, t.context_bundle, t.target_repo, t.task_group_id
         FROM pipeline.tasks t
        WHERE t.task_type = 'spec-task'
          AND t.status = 'pending'
          ${repo ? "AND t.target_repo = $1" : ""}
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

  async completeSpecTask(id: string): Promise<CompletedSpecTask> {
    const { rows } = await this.pool.query(
      `SELECT context_bundle, target_repo, status FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    const task = rows[0] as
      | {
          context_bundle: Record<string, unknown> | null;
          target_repo: string;
          status: string;
        }
      | undefined;

    if (!task || task.status !== "running") {
      return { completed: false, unblocked: [] };
    }

    await this.pool.query(
      `UPDATE pipeline.tasks SET status = 'completed', updated_at = now() WHERE id = $1`,
      [id],
    );

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
