import { selectList } from "../../../lib/row.js";
import { PIPELINE_TASK_COLUMNS } from "../../../domain/models/pipeline-task.js";
import type { PgPool } from "../../memory-store.js";
import type { PipelineTask } from "../../../domain/types.js";
import { enforceSettableTaskColumns } from "./task-queue-port.js";
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
import { PgSpecTaskQueries } from "./task-queue-pg-spec-tasks.js";

/** The INSERT column list and its matching value list, with the always-present three first and the optional columns appended in a stable order. */
function insertColumnsAndValues(input: InsertTaskInput): {
  cols: string[];
  vals: unknown[];
} {
  const optional = optionalTaskColumns(input);

  return {
    cols: [
      "description",
      "task_type",
      "target_repo",
      ...optional.map(([key]) => key),
    ],
    vals: [
      input.description,
      input.taskType,
      input.targetRepo,
      ...optional.map(([, value]) => value),
    ],
  };
}

/** `key = $n` assignments plus their positional values, numbered from $1 so the caller can bind the id at $n+1. */
function setClausesFor(columns: Record<string, unknown>): {
  clauses: string[];
  params: unknown[];
} {
  const entries = Object.entries(columns);

  return {
    clauses: entries.map(([key], i) => `${key} = $${i + 1}`),
    params: entries.map(([, value]) => value),
  };
}

function optionalTaskColumns(input: InsertTaskInput): [string, unknown][] {
  const candidates: [string, unknown][] = [
    ["status", input.status],
    [
      "context_bundle",
      input.contextBundle !== undefined
        ? JSON.stringify(input.contextBundle)
        : undefined,
    ],
    ["created_by", input.createdBy],
    ["task_group_id", input.taskGroupId],
  ];

  return candidates.filter(([, value]) => value !== undefined);
}

const insertedId = (rows: { id?: unknown }[]): string | null =>
  (rows.at(0)?.id as string | undefined) ?? null;

/** Postgres TaskQueueRepository; org-wide claim/sweep SQL from Floor jobs. */
export class PgTaskQueue implements TaskQueueRepository {
  private readonly specTasks: PgSpecTaskQueries;

  constructor(private readonly pool: PgPool) {
    this.specTasks = new PgSpecTaskQueries(pool);
  }

  async claimNextPending(): Promise<PipelineTask | null> {
    const { rows } = await this.pool.query<PipelineTask>(
      `SELECT ${selectList(PIPELINE_TASK_COLUMNS)} FROM pipeline.tasks
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

    return (rows.at(0) as PipelineTask | undefined) ?? null;
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

    // eslint-disable-next-line re-lint/no-duplicate-code -- the SQL half of the same TaskQueueRepository port: Maps in the double, queries here, and only the signatures both must satisfy are what the token match sees
    return rows as StaleTask[];
  }

  findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]> {
    return this.specTasks.findReadySpecTasks(repo);
  }

  countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]> {
    return this.specTasks.countRunningSpecTasksByGroup();
  }

  countUnmergedInGroup(groupId: string): Promise<number> {
    return this.specTasks.countUnmergedInGroup(groupId);
  }

  claimSpecTask(id: string, agentId = "spec-task-executor"): Promise<boolean> {
    return this.specTasks.claimSpecTask(id, agentId);
  }

  completeSpecTask(id: string): Promise<CompletedSpecTask> {
    return this.specTasks.completeSpecTask(id);
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

    return (rows.at(0) as TaskPrInfo | undefined) ?? null;
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

    return (rows.at(0) as ReviewableTask | undefined) ?? null;
  }

  async incrementReviewIteration(taskId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.tasks
          SET review_iteration = COALESCE(review_iteration, 0) + 1
        WHERE id = $1
      RETURNING review_iteration`,
      [taskId],
    );

    return (rows.at(0)?.review_iteration as number | undefined) ?? 1;
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

  hasSpecTasksForSlug(repo: string, slug: string): Promise<boolean> {
    return this.specTasks.hasSpecTasksForSlug(repo, slug);
  }

  async contextRefs(taskId: string): Promise<TaskContextRefs | null> {
    const { rows } = await this.pool.query(
      `SELECT context_refs FROM pipeline.tasks WHERE id = $1`,
      [taskId],
    );

    return (rows.at(0)?.context_refs as TaskContextRefs | undefined) ?? null;
  }

  async insertTask(input: InsertTaskInput): Promise<string | null> {
    const { cols, vals } = insertColumnsAndValues(input);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.tasks (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING id`,
      vals,
    );

    return insertedId(rows);
  }

  async setColumns(
    taskId: string,
    columns: Record<string, unknown>,
  ): Promise<void> {
    enforceSettableTaskColumns(columns);
    const { clauses, params } = setClausesFor(columns);

    if (clauses.length === 0) {
      return;
    }
    await this.pool.query(
      `UPDATE pipeline.tasks SET ${clauses.join(", ")} WHERE id = $${clauses.length + 1}`,
      [...params, taskId],
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

    return (rows.at(0) as { id: string } | undefined) ?? null;
  }

  async activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT id FROM pipeline.tasks WHERE issue_number = $1 AND target_repo = $2 AND status NOT IN ('failed', 'cancelled')`,
      [issueNumber, repo],
    );

    return (rows.at(0) as { id: string } | undefined) ?? null;
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
