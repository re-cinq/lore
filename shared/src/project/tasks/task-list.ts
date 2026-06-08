import type { PipelineTask } from "../../types.js";
import type { TaskStorePort, TaskWithEvents, TaskListResult } from "./task-store-port.js";
import { Task } from "./task.js";

/**
 * project.tasks — the record side, repo bound. pendingTasks/runningTasks/
 * executedTasks are async METHODS (they do I/O); only the sub-facade itself is
 * a sync property.
 */
export class TaskList {
  constructor(
    private readonly repo: string,
    private readonly store: TaskStorePort,
  ) {}

  pendingTasks(): Promise<Task[]> {
    return this.wrap(this.store.pending(this.repo));
  }

  runningTasks(): Promise<Task[]> {
    return this.wrap(this.store.running(this.repo));
  }

  executedTasks(): Promise<Task[]> {
    return this.wrap(this.store.executed(this.repo));
  }

  async getById(id: string): Promise<Task | null> {
    const row = await this.store.getById(id);
    return row ? new Task(row, this.store) : null;
  }

  // ── direct task ops (taskId-keyed; the repo binding is context only) ──

  list(status?: string, limit?: number): Promise<TaskListResult> {
    return this.store.list(status, limit);
  }

  getWithEvents(id: string): Promise<TaskWithEvents | null> {
    return this.store.getWithEvents(id);
  }

  setStatus(id: string, status: string, extra?: Record<string, unknown>): Promise<void> {
    return this.store.setStatus(id, status, extra);
  }

  updateStatus(id: string, status: string, meta?: unknown): Promise<void> {
    return this.store.updateStatus(id, status, meta);
  }

  recordEvent(id: string, fromStatus: string | null, toStatus: string | null, meta?: unknown): Promise<void> {
    return this.store.recordEvent(id, fromStatus, toStatus, meta);
  }

  cancel(id: string): Promise<{ task_id: string; status: string }> {
    return this.store.cancel(id);
  }

  markMerged(id: string): Promise<{ task_id: string; status: string }> {
    return this.store.markMerged(id);
  }

  private async wrap(rows: Promise<PipelineTask[]>): Promise<Task[]> {
    return (await rows).map((row) => new Task(row, this.store));
  }
}
