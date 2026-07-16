import type { PipelineTask } from "../../types.js";

/** A running/queued task idle long enough to be a crash-recovery candidate. */
export interface RecoverableTask {
  id: string;
  task_type: string;
}

/** A `running` task past the safety-net threshold, with its computed age. */
export interface StaleTask {
  id: string;
  target_repo: string;
  task_type: string;
  created_at: string;
  issue_number: number | null;
  age_hours: number;
}

/** A pending spec-task whose declared dependencies are all satisfied. */
export interface ReadySpecTask {
  id: string;
  description: string;
  context_bundle: Record<string, unknown> | null;
  target_repo: string;
  task_group_id: string | null;
}

/** Running/queued spec-task count for one task group (cnt is pg's text COUNT). */
export interface SpecGroupCount {
  task_group_id: string;
  cnt: string;
}

/** A task parked in `awaiting_approval` that carries an issue (the label gate). */
export interface AwaitingApprovalTask {
  id: string;
  target_repo: string;
  issue_number: number;
}

/** PR coordinates for one task, used by the auto-merge policy lookup. */
export interface TaskPrInfo {
  pr_number: number | null;
  target_repo: string | null;
  target_branch: string | null;
}

/** A task with an open PR whose merge/close state the merge-check polls. */
export interface MergeableTask {
  id: string;
  target_repo: string;
  target_branch: string | null;
  pr_url: string;
  pr_number: number;
  issue_number: number | null;
  task_type: string;
  description: string;
  created_at: string;
  task_group_id: string | null;
  context_bundle: {
    feature_id?: string;
    slug?: string;
    spec_slug?: string;
  } | null;
}

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

/**
 * From an already-ready set, the dependents unblocked by completing
 * `specTaskId` in `specSlug`: same-spec tasks that list it in `depends_on`.
 * Shared by both queue adapters so the readiness predicate stays single-sourced.
 */
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
export interface ReviewableTask {
  id: string;
  description: string;
  task_type: string;
  target_repo: string;
  pr_number: number;
  pr_url: string;
  issue_number: number | null;
  review_iteration: number | null;
  target_branch: string;
}

/**
 * Org-wide (repo-agnostic) task-queue mechanics over `pipeline.tasks`: the
 * worker claim, crash-recovery + staleness sweeps, and spec-task DAG dispatch.
 * This SQL used to live inline across Floor jobs; single-sourced here so the
 * queue semantics have one home. Repo-scoped task *record* ops stay on
 * `project.tasks`; this is the cross-repo claim/sweep surface.
 */
export interface TaskQueueRepository {
  /**
   * The next runnable task: `pending`, immediate-priority first then oldest,
   * with a 30-second grace window before a `normal` task is eligible (so a
   * local runner can claim it first). Null when nothing is runnable.
   */
  claimNextPending(): Promise<PipelineTask | null>;

  /** running/queued tasks idle past `maxAgeMinutes` (default 30) — recovery candidates. */
  findRecoverable(maxAgeMinutes?: number): Promise<RecoverableTask[]>;

  /** `running` tasks older than `thresholdHours` — the stale-task safety-net set. */
  findStaleRunning(thresholdHours: number): Promise<StaleTask[]>;

  /**
   * pending spec-tasks whose `depends_on` are all completed/merged in the same
   * spec. Org-wide by default; pass `repo` to scope to one target repo (the
   * repo-scoped MCP `lore_ready_tasks` path).
   */
  findReadySpecTasks(repo?: string): Promise<ReadySpecTask[]>;

  /** running/queued spec-task counts per group, for the concurrency gate. */
  countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]>;

  /**
   * Count tasks in `groupId` whose status is not `merged` — the spec-status-upkeep
   * (FR1) group-completion signal. Zero means every task in the group has merged.
   * A sibling closed-without-merge keeps the count above zero, so no flip fires
   * for a partially-abandoned group; a human resolves those.
   */
  countUnmergedInGroup(groupId: string): Promise<number>;

  /**
   * Atomically flip a still-`pending` spec-task to `running`; true iff this
   * caller won. `agentId` records the claimer (defaults to `spec-task-executor`).
   */
  claimSpecTask(id: string, agentId?: string): Promise<boolean>;

  /**
   * Flip a `running` spec-task to `completed` and report the dependents it
   * unblocks (pending same-spec tasks whose deps are now all satisfied).
   * `completed` is false when the task is unknown or not `running`.
   */
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

  /** Set arbitrary allow-listed task columns by id WITHOUT touching status or updated_at. */
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
