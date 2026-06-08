import type { PipelineTask } from "../../types.js";
import type { TaskStorePort } from "./task-store-port.js";
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

  private async wrap(rows: Promise<PipelineTask[]>): Promise<Task[]> {
    return (await rows).map((row) => new Task(row, this.store));
  }
}
