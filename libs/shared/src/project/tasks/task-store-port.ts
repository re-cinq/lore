import type { PipelineTask } from "../../types.js";
import type {
  CreatedTask,
  CreateTaskInput,
  RetriedTask,
} from "../../pipeline-tasks.js";

export type { CreateTaskInput, CreatedTask, RetriedTask };

/** Task states still "in flight" (duplicate suppression); single-sourced for drift-dedup/gap-dedup. "failed" deliberately excluded — whether it suppresses a refile is job-specific. */
export const OPEN_TASK_STATES = [
  "pending",
  "queued",
  "running",
  "pr-created",
  "review",
  "retried",
] as const;

// Task records port; backed by pipeline.tasks (cluster) or ~/.lore/local-tasks.json (local), same surface. Record side only — execution lives behind AgentRunnerPort; pg SQL single-sourced in shared/src/pipeline-tasks.ts.

export type TaskAction = "claim" | "cancel" | "retry";

/** Status groups behind the pending/running/executed views and transition targets; shared by both adapters so the views can't drift. */
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
/** A spec-task as the feature-detail decomposition view reads it: the three columns it needs, not the whole task row. */
export interface FeatureTaskRow {
  description: string;
  status: string;
  context_bundle: Record<string, unknown> | null;
}

export interface FindOpenLikeInput {
  repo: string;
  taskType: string;
  /** Matched as an unescaped SQL LIKE prefix (<prefix>%, no ESCAPE) — a literal % or _ acts as a wildcard in both adapters. */
  descriptionPrefix: string;
  statuses: readonly string[];
}

/** A spec-drift dedup row — status + age + the issue it opened (if any); status pinned to the pipeline.tasks model. */
export type DriftTaskRow = Pick<PipelineTask, "status"> & {
  created_at: string | Date;
  issue_number: number | null;
};

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
  /** Spec-tasks a feature's merged spec decomposed into (ADR-029), in spec-task-id order; keyed on context_bundle->>'feature_id' (stamped by the issues station). */
  specTasksForFeature(
    repo: string,
    featureId: string,
  ): Promise<FeatureTaskRow[]>;
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
