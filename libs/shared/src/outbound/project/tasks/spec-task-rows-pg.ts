import type { PgPool } from "../../memory-store.js";
import type { PipelineTask } from "../../../domain/types.js";
import { updateTaskStatus } from "../../../domain/pipeline-tasks.js";
import type { ExistingSpecTask } from "../../../domain/feature-planning/spec-task-reconcile.js";
import type {
  SpecTaskInput,
  SpecTaskRows,
} from "./spec-task-reconcile-store.js";
import type { CreateTaskInput } from "./task-store-port.js";

// A plan's spec-tasks: those stamped with its plan, or grouped under the run that filed them (the first issues-station runs stamped no plan).
const PLAN_SPEC_TASKS_SQL = `SELECT id, status, issue_number, pr_number, context_bundle->>'spec_task_id' AS spec_task_id
   FROM pipeline.tasks
  WHERE target_repo = $1
    AND task_type = 'spec-task'
    AND (context_bundle->>'plan_id' = $2 OR task_group_id::text = $3)`;

const REWRITE_COLUMNS = `description = $2,
        context_bundle = $3,
        issue_number = $4,
        issue_url = $5,
        task_group_id = COALESCE($6::uuid, task_group_id),
        updated_at = now()`;

const UPDATE_SPEC_TASK_SQL = `UPDATE pipeline.tasks SET ${REWRITE_COLUMNS} WHERE id = $1`;

const REQUEUE_SPEC_TASK_SQL = `UPDATE pipeline.tasks
    SET ${REWRITE_COLUMNS}, status = 'pending', failure_reason = NULL, pr_number = NULL, pr_url = NULL
  WHERE id = $1`;

type PlanSpecTaskRow = Pick<
  PipelineTask,
  "id" | "status" | "issue_number" | "pr_number"
> & { spec_task_id: string | null };

/** {@link SpecTaskRows} over pipeline.tasks. */
export class PgSpecTaskRows implements SpecTaskRows {
  constructor(
    private readonly pool: PgPool,
    readonly create: (input: CreateTaskInput) => Promise<unknown>,
  ) {}

  async planSpecTasks(
    repo: string,
    { planId, groupId }: { planId?: string; groupId?: string },
  ): Promise<ExistingSpecTask[]> {
    const { rows } = await this.pool.query<PlanSpecTaskRow>(
      PLAN_SPEC_TASKS_SQL,
      [repo, planId ?? null, groupId ?? null],
    );

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      issueNumber: row.issue_number ?? null,
      ...(row.spec_task_id ? { specTaskId: row.spec_task_id } : {}),
      prNumber: row.pr_number ?? null,
    }));
  }

  async update(id: string, input: SpecTaskInput): Promise<void> {
    await this.pool.query(UPDATE_SPEC_TASK_SQL, rewriteParams(id, input));
  }

  async requeue(id: string, input: SpecTaskInput): Promise<void> {
    await this.pool.query(REQUEUE_SPEC_TASK_SQL, rewriteParams(id, input));
  }

  cancel(id: string): Promise<void> {
    return updateTaskStatus(this.pool, id, "cancelled", {
      cancelled_by: "issues-station",
      reason: "the plan's decomposition no longer has this task",
    });
  }
}

function rewriteParams(id: string, input: SpecTaskInput): unknown[] {
  return [
    id,
    input.description,
    input.contextBundle ?? null,
    input.issueNumber,
    input.issueUrl ?? null,
    input.taskGroupId ?? null,
  ];
}
