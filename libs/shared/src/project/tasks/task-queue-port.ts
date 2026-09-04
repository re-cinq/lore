import type { PipelineTask } from "../../types.js";
import { enforceTrue } from "../../lib/enforce.js";
import {
  PIPELINE_TASK_COLUMNS,
  type PipelineTask as TaskModel,
} from "../../models/pipeline-task.js";

/** One pipeline.tasks column per named field, typed off the model — a query-row projection instead of a restated table. */
type TaskColumn<K extends keyof TaskModel> = {
  [F in K as (typeof PIPELINE_TASK_COLUMNS)[F]]: TaskModel[F];
};

/** Columns setColumns may write (allow-listed to keep the dynamic SQL injection-safe). */
export const SETTABLE_TASK_COLUMNS = new Set([
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

/** Rejects keys outside SETTABLE_TASK_COLUMNS; shared by both adapters so a typo'd column fails loudly and identically in both. */
export function enforceSettableTaskColumns(
  columns: Record<string, unknown>,
): void {
  for (const key of Object.keys(columns)) {
    enforceTrue(
      SETTABLE_TASK_COLUMNS.has(key),
      Error,
      `setColumns: unknown task column "${key}" (not in SETTABLE_TASK_COLUMNS)`,
    );
  }
}

/** A running/queued task idle long enough to be a crash-recovery candidate. */
export interface RecoverableTask {
  id: string;
  task_type: string;
}

/** A `running` task past the safety-net threshold, with its computed age. */
export type StaleTask = TaskColumn<"id" | "targetRepo" | "taskType"> & {
  created_at: string;
  issue_number: number | null;
  age_hours: number;
};

/** A pending spec-task whose declared dependencies are all satisfied. */
export type ReadySpecTask = TaskColumn<
  "id" | "description" | "contextBundle" | "targetRepo" | "taskGroupId"
>;

/** Running/queued spec-task count for one task group (cnt is pg's text COUNT). */
export interface SpecGroupCount {
  task_group_id: string;
  cnt: string;
}

/** A task parked in `awaiting_approval` that carries an issue (the label gate). */
export type AwaitingApprovalTask = TaskColumn<"id" | "targetRepo"> & {
  issue_number: number;
};

/** PR coordinates for one task, used by the auto-merge policy lookup. */
export type TaskPrInfo = TaskColumn<"prNumber" | "targetBranch"> & {
  target_repo: string | null;
};

/** A task with an open PR whose merge/close state the merge-check polls. */
export type MergeableTask = TaskColumn<
  | "id"
  | "targetRepo"
  | "targetBranch"
  | "issueNumber"
  | "taskType"
  | "description"
  | "taskGroupId"
> & {
  created_at: string;
  pr_url: string;
  pr_number: number;
  context_bundle: {
    feature_id?: string;
    slug?: string;
    spec_slug?: string;
  } | null;
};

/** Contributing-context refs captured on a task (PR-outcome feedback target). */
export interface TaskContextRefs {
  fact_ids?: string[];
  memory_ids?: string[];
}

/** A gate-free `pipeline.tasks` insert (spec-task / feature-decompose sync). */
export interface InsertTaskInput {
  description: string;
  taskType: string;
  targetRepo: string;
  status?: string;
  contextBundle?: unknown;
  createdBy?: string;
  taskGroupId?: string;
}

/** Outcome of completing a spec-task: whether it flipped, and its now-ready dependents. */
export interface CompletedSpecTask {
  completed: boolean;
  /** `"<spec_task_id>: <description>"` for each dependent unblocked by this completion. */
  unblocked: string[];
}

/** Dependents unblocked by completing specTaskId in specSlug (same-spec tasks listing it in depends_on); shared by both adapters so the predicate stays single-sourced. */
export function unblockedBy(
  ready: ReadySpecTask[],
  specSlug: string,
  specTaskId: string,
): string[] {
  return ready
    .filter((t) => {
      const cb = t.context_bundle ?? {};
      const deps = cb.depends_on;

      return (
        cb.spec_slug === specSlug &&
        Array.isArray(deps) &&
        deps.includes(specTaskId)
      );
    })
    .map((t) => `${(t.context_bundle ?? {}).spec_task_id}: ${t.description}`);
}

/** A task with an open PR still eligible for the review-react loop. */
export type ReviewableTask = TaskColumn<
  "id" | "description" | "taskType" | "targetRepo" | "issueNumber"
> & {
  pr_number: number;
  pr_url: string;
  review_iteration: number | null;
  target_branch: string;
};

/** Org-wide task-queue mechanics over pipeline.tasks (claim, crash-recovery/staleness sweeps, spec-task DAG dispatch); single-sourced from inline Floor-job SQL. Repo-scoped task record ops stay on project.tasks. */
export interface TaskQueueRepository {
  /** Next runnable pending task (immediate-priority first, then oldest; 30s grace before a normal task is eligible, so a local runner can claim first); null if none. */
  claimNextPending(): Promise<PipelineTask | null>;

  /** running/queued tasks idle past `maxAgeMinutes` (default 30) — recovery candidates. */
  findRecoverable(maxAgeMinutes?: number): Promise<RecoverableTask[]>;

  /** `running` tasks older than `thresholdHours` — the stale-task safety-net set. */
  findStaleRunning(thresholdHours: number): Promise<StaleTask[]>;

  /** Pending spec-tasks whose depends_on are all completed/merged in the same spec; org-wide by default, or scoped via repo (lore_ready_tasks path). */
  findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]>;

  /** running/queued spec-task counts per group, for the concurrency gate. */
  countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]>;

  /** Count of non-merged tasks in groupId (spec-status-upkeep FR1 group-completion signal); a closed-without-merge sibling keeps it above zero so no flip fires on a partially-abandoned group. */
  countUnmergedInGroup(groupId: string): Promise<number>;

  /** Atomically flips a pending spec-task to running; true iff this caller won. agentId records the claimer (default spec-task-executor). */
  claimSpecTask(id: string, agentId?: string): Promise<boolean>;

  /** Flips a running spec-task to completed and reports the dependents it unblocks; completed is false if the task is unknown or not running. */
  completeSpecTask(id: string): Promise<CompletedSpecTask>;

  /** Tasks parked in `awaiting_approval` that carry an issue (the approval-label gate). */
  awaitingApproval(): Promise<AwaitingApprovalTask[]>;

  /** Distinct non-null target repos across all tasks, ascending — the repo scan set. */
  distinctTargetRepos(): Promise<string[]>;

  /** PR coordinates for one task id, or null when the task is unknown. */
  prInfo(taskId: string): Promise<TaskPrInfo | null>;

  /** Tasks with an open PR still eligible for the review-react loop (iteration < 3). */
  reviewable(): Promise<ReviewableTask[]>;

  /** The single reviewable task for a repo + PR number, or null. */
  reviewableForPR(
    repo: string,
    prNumber: number,
  ): Promise<ReviewableTask | null>;

  /** Bump a task's `review_iteration` (COALESCE(_,0)+1); returns the new value. */
  incrementReviewIteration(taskId: string): Promise<number>;

  /** Tasks with an open PR (`pr-created`/`review`) whose merge state to poll. */
  mergeableTasks(): Promise<MergeableTask[]>;

  /** True when a spec-task for this repo + spec slug already exists (idempotency). */
  hasSpecTasksForSlug(repo: string, slug: string): Promise<boolean>;

  /** The contributing-context refs JSONB for a task, or null. */
  contextRefs(taskId: string): Promise<TaskContextRefs | null>;

  /** Gate-free task insert (spec-task / feature-decompose). Returns the new id, or null on conflict. */
  insertTask(input: InsertTaskInput): Promise<string | null>;

  /** Sets arbitrary allow-listed task columns by id without touching status/updated_at; throws on a key outside SETTABLE_TASK_COLUMNS. */
  setColumns(taskId: string, columns: Record<string, unknown>): Promise<void>;

  /** The most recent task id for a repo + PR number (newest first), or null. */
  latestTaskByPr(
    repo: string,
    prNumber: number,
  ): Promise<{ id: string } | null>;

  /** The active task id for a repo + issue (status NOT IN failed/cancelled), or null. */
  activeTaskByIssue(
    repo: string,
    issueNumber: number,
  ): Promise<{ id: string } | null>;

  /** Flip merged: feature-request tasks on a branch still in pr-created/review → merged. */
  markFeatureRequestMergedOnBranch(repo: string, branch: string): Promise<void>;
}
