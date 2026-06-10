import type { PipelineTask } from "../../types.js";
import type { CreateTaskInput } from "../../pipeline-tasks.js";

export type { CreateTaskInput };

/**
 * Task records port. Backed by pipeline.tasks (cluster) or
 * ~/.lore/local-tasks.json (local) — same surface, two adapters. This is the
 * RECORD side; execution lives behind AgentRunnerPort. The SQL for the pg
 * adapter is single-sourced in shared/src/pipeline-tasks.ts.
 */

export type TaskAction = "claim" | "cancel" | "retry";

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
  // writes
  create(input: CreateTaskInput): Promise<any>;
  retry(id: string): Promise<any>;
  setStatus(id: string, status: string, extra?: Record<string, unknown>): Promise<void>;
  updateStatus(id: string, status: string, meta?: unknown): Promise<void>;
  recordEvent(id: string, fromStatus: string | null, toStatus: string | null, meta?: unknown): Promise<void>;
  cancel(id: string): Promise<{ task_id: string; status: string }>;
  markMerged(id: string): Promise<{ task_id: string; status: string }>;
  transition(id: string, action: TaskAction, meta?: TaskTransitionMeta): Promise<PipelineTask>;
}
