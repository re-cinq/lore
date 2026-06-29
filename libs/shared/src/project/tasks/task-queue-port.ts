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

  /** pending spec-tasks whose `depends_on` are all completed/merged in the same spec. */
  findReadySpecTasks(): Promise<ReadySpecTask[]>;

  /** running/queued spec-task counts per group, for the concurrency gate. */
  countRunningSpecTasksByGroup(): Promise<SpecGroupCount[]>;

  /** Atomically flip a still-`pending` spec-task to `running`; true iff this caller won. */
  claimSpecTask(id: string): Promise<boolean>;
}
