import type { PgPool } from "../../memory-store.js";
import type { PipelineTask } from "../../types.js";
import { unblockedBy } from "./task-queue-port.js";
import type {
  TaskQueueRepository,
  RecoverableTask,
  StaleTask,
  ReadySpecTask,
  CompletedSpecTask,
  SpecGroupCount,
  AwaitingApprovalTask,
  TaskPrInfo,
  ReviewableTask,
  MergeableTask,
  TaskContextRefs,
  InsertTaskInput,
} from "./task-queue-port.js";

/** Columns setColumns may write (allow-listed to keep the dynamic SQL injection-safe). */
const SETTABLE_TASK_COLUMNS = new Set([
  "issue_number",
  "issue_url",
  "review_iteration",
  "pr_url",
  "pr_number",
  "target_branch",
  "failure_reason",
  "log_url",
  "agent_id",
]);

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
    const { rows } = await this.pool.query<PipelineTask>(
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
    const { rows } = await this.pool.query<RecoverableTask>(
      `SELECT id, task_type FROM pipeline.tasks
        WHERE status IN ('running', 'queued')
          AND updated_at < now() - ($1 || ' minutes')::interval`,
      [String(maxAgeMinutes)],
    );

    return rows as RecoverableTask[];
  }

  async findStaleRunning(thresholdHours: number): Promise<StaleTask[]> {
    const { rows } = await this.pool.query<StaleTask>(
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

    const specTaskId = task.context_bundle?.spec_task_id as string | undefined;
    const specSlug = task.context_bundle?.spec_slug as string | undefined;

    if (!specTaskId || !specSlug) {
      return { completed: true, unblocked: [] };
    }

    const ready = await this.findReadySpecTasks(task.target_repo);

    return {
      completed: true,
      unblocked: unblockedBy(ready, specSlug, specTaskId),
    };
  }

  async awaitingApproval(): Promise<AwaitingApprovalTask[]> {
    const { rows } = await this.pool.query<AwaitingApprovalTask>(
      `SELECT id, target_repo, issue_number FROM pipeline.tasks
        WHERE status = 'awaiting_approval' AND issue_number IS NOT NULL`,
    );

    return rows as AwaitingApprovalTask[];
  }

  async distinctTargetRepos(): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT target_repo
         FROM pipeline.tasks
        WHERE target_repo IS NOT NULL
        ORDER BY target_repo`,
    );

    return (rows as { target_repo: string }[]).map((r) => r.target_repo);
  }

  async prInfo(taskId: string): Promise<TaskPrInfo | null> {
    const { rows } = await this.pool.query<TaskPrInfo>(
      `SELECT pr_number, target_repo, target_branch
         FROM pipeline.tasks WHERE id = $1`,
      [taskId],
    );

    return (rows[0] as TaskPrInfo) ?? null;
  }

  async reviewable(): Promise<ReviewableTask[]> {
    const { rows } = await this.pool.query<ReviewableTask>(
      `SELECT id, description, task_type, target_repo, pr_number, pr_url,
              issue_number, review_iteration, target_branch
         FROM pipeline.tasks
        WHERE status IN ('pr-created', 'review', 'revision-requested')
          AND pr_number IS NOT NULL
          AND (review_iteration IS NULL OR review_iteration < 3)`,
    );

    return rows as ReviewableTask[];
  }

  async reviewableForPR(
    repo: string,
    prNumber: number,
  ): Promise<ReviewableTask | null> {
    const { rows } = await this.pool.query<ReviewableTask>(
      `SELECT id, description, task_type, target_repo, pr_number, pr_url,
              issue_number, review_iteration, target_branch
         FROM pipeline.tasks
        WHERE status IN ('pr-created', 'review', 'revision-requested')
          AND target_repo = $1
          AND pr_number = $2
          AND (review_iteration IS NULL OR review_iteration < 3)
        LIMIT 1`,
      [repo, prNumber],
    );

    return (rows[0] as ReviewableTask) ?? null;
  }

  async incrementReviewIteration(taskId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.tasks
          SET review_iteration = COALESCE(review_iteration, 0) + 1
        WHERE id = $1
      RETURNING review_iteration`,
      [taskId],
    );

    return (rows[0]?.review_iteration as number) ?? 1;
  }

  async mergeableTasks(): Promise<MergeableTask[]> {
    const { rows } = await this.pool.query<MergeableTask>(
      `SELECT id, target_repo, target_branch, pr_url, pr_number, issue_number,
              task_type, description, created_at, task_group_id, context_bundle
         FROM pipeline.tasks
        WHERE status IN ('pr-created', 'review')
          AND pr_number IS NOT NULL
          AND pr_url IS NOT NULL`,
    );

    return rows as MergeableTask[];
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

  async contextRefs(taskId: string): Promise<TaskContextRefs | null> {
    const { rows } = await this.pool.query(
      `SELECT context_refs FROM pipeline.tasks WHERE id = $1`,
      [taskId],
    );

    return (rows[0]?.context_refs as TaskContextRefs) ?? null;
  }

  async insertTask(input: InsertTaskInput): Promise<string | null> {
    const cols = ["description", "task_type", "target_repo"];
    const vals: unknown[] = [
      input.description,
      input.taskType,
      input.targetRepo,
    ];

    if (input.status !== undefined) {
      cols.push("status");
      vals.push(input.status);
    }

    if (input.contextBundle !== undefined) {
      cols.push("context_bundle");
      vals.push(JSON.stringify(input.contextBundle));
    }

    if (input.createdBy !== undefined) {
      cols.push("created_by");
      vals.push(input.createdBy);
    }

    if (input.taskGroupId !== undefined) {
      cols.push("task_group_id");
      vals.push(input.taskGroupId);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.tasks (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING id`,
      vals,
    );

    return (rows[0]?.id as string) ?? null;
  }

  async setColumns(
    taskId: string,
    columns: Record<string, unknown>,
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(columns)) {
      if (!SETTABLE_TASK_COLUMNS.has(key)) {
        continue;
      }
      setClauses.push(`${key} = $${idx}`);
      params.push(value);
      idx++;
    }

    if (setClauses.length === 0) {
      return;
    }
    params.push(taskId);
    await this.pool.query(
      `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idx}`,
      params,
    );
  }

  async latestTaskByPr(
    repo: string,
    prNumber: number,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT id FROM pipeline.tasks WHERE target_repo = $1 AND pr_number = $2 ORDER BY created_at DESC LIMIT 1`,
      [repo, prNumber],
    );

    return (rows[0] as { id: string }) ?? null;
  }

  async activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT id FROM pipeline.tasks WHERE issue_number = $1 AND target_repo = $2 AND status NOT IN ('failed', 'cancelled')`,
      [issueNumber, repo],
    );

    return (rows[0] as { id: string }) ?? null;
  }

  async markFeatureRequestMergedOnBranch(
    repo: string,
    branch: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.tasks SET status = 'merged', updated_at = now()
        WHERE task_type = 'feature-request' AND target_repo = $1 AND target_branch = $2
          AND status IN ('pr-created', 'review')`,
      [repo, branch],
    );
  }
}
