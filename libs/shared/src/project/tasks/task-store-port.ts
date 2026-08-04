import type { PipelineTask } from "../../types.js";
import type {
  CreatedTask,
  CreateTaskInput,
  RetriedTask,
} from "../../pipeline-tasks.js";

export type { CreateTaskInput, CreatedTask, RetriedTask };

/**
 * The task states where a task is still "in flight" — a new duplicate should be
 * suppressed. Single source for the drift-dedup and gap-dedup jobs (which each
 * used to hard-code their own, divergent, list). `failed` is deliberately NOT
 * here: whether a failed task suppresses a refile is job-specific (spec-drift
 * applies a cooldown; gap-detect suppresses outright), so those jobs add it
 * explicitly when they want it.
 */
export const OPEN_TASK_STATES = [
  "pending",
  "queued",
  "running",
  "pr-created",
  "review",
  "retried",
] as const;

/**
 * Task records port. Backed by pipeline.tasks (cluster) or
 * ~/.lore/local-tasks.json (local) — same surface, two adapters. This is the
 * RECORD side; execution lives behind AgentRunnerPort. The SQL for the pg
 * adapter is single-sourced in shared/src/pipeline-tasks.ts.
 */

export type TaskAction = "claim" | "cancel" | "retry";

/**
 * The status groups behind the pending/running/executed views and the
 * transition target per action. Shared by the Pg adapter and the in-memory
 * double so the views cannot drift between them.
 */
export const PENDING_STATUSES = ["pending", "queued", "awaiting_approval"];
export const RUNNING_STATUSES = [
  "running",
  "running-local",
  "review",
  "pr-created",
];
export const EXECUTED_STATUSES = ["completed", "merged", "failed", "cancelled"];

export const NEXT_STATUS: Record<TaskAction, string> = {
  claim: "running-local",
  cancel: "cancelled",
  retry: "retried",
};

/** Dedup lookup: open (per `statuses`) tasks of one type whose description starts with a prefix. */
export interface FindOpenLikeInput {
  repo: string;
  taskType: string;
  descriptionPrefix: string;
  statuses: readonly string[];
}

/** A spec-drift dedup row — status + age + the issue it opened (if any). */
export interface DriftTaskRow {
  status: string;
  created_at: string | Date;
  issue_number: number | null;
}

export interface TaskTransitionMeta {
  agentId?: string;
}

export interface TaskWithEvents extends PipelineTask {
  events: unknown[];
}

export interface TaskListResult {
  tasks: PipelineTask[];
  total: number;
}

export interface TaskStorePort {
  // repo-scoped reads
  pending(repo: string): Promise<PipelineTask[]>;
  running(repo: string): Promise<PipelineTask[]>;
  executed(repo: string): Promise<PipelineTask[]>;
  list(status?: string, limit?: number): Promise<TaskListResult>;
  // by-id reads
  getById(id: string): Promise<PipelineTask | null>;
  getWithEvents(id: string): Promise<TaskWithEvents | null>;
  /** Open (per `statuses`) tasks of one type whose description starts with the prefix — job dedup. */
  findOpenLike(input: FindOpenLikeInput): Promise<PipelineTask[]>;
  /** Drift dedup: tasks of one type for a repo keyed by `context_bundle->>'spec_path'`. */
  driftTasksForSpec(
    repo: string,
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]>;
  // writes
  create(input: CreateTaskInput): Promise<CreatedTask>;
  retry(id: string): Promise<RetriedTask>;
  setStatus(
    id: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<void>;
  /** CAS status flip: updates only while the row is still `expectedStatus`; true iff this caller won. */
  setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<boolean>;
  updateStatus(
    id: string,
    status: string,
    meta?: Record<string, unknown>,
  ): Promise<void>;
  recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void>;
  cancel(id: string): Promise<{ task_id: string; status: string }>;
  markMerged(id: string): Promise<{ task_id: string; status: string }>;
  transition(
    id: string,
    action: TaskAction,
    meta?: TaskTransitionMeta,
  ): Promise<PipelineTask>;
}
