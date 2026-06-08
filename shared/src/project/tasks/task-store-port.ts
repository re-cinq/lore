import type { PipelineTask } from "../../types.js";

/**
 * Task records port. Backed by pipeline.tasks (cluster) or
 * ~/.lore/local-tasks.json (local) — same surface, two adapters. This is the
 * RECORD side; execution lives behind AgentRunnerPort.
 */

export type TaskAction = "claim" | "cancel" | "retry";

export interface TaskTransitionMeta {
  agentId?: string;
}

export interface TaskStorePort {
  pending(repo: string): Promise<PipelineTask[]>;
  running(repo: string): Promise<PipelineTask[]>;
  executed(repo: string): Promise<PipelineTask[]>;
  getById(id: string): Promise<PipelineTask | null>;
  transition(id: string, action: TaskAction, meta?: TaskTransitionMeta): Promise<PipelineTask>;
}
