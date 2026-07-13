import type { PipelineTask } from "../../types.js";
import type {
  TaskStorePort,
  TaskWithEvents,
  TaskListResult,
  CreateTaskInput,
  DriftTaskRow,
  FindOpenLikeInput,
} from "./task-store-port.js";
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

  // ── task ops over the single source ──

  /** Create a task. The bound repo is the default targetRepo unless input overrides it. */
  create(
    input: Omit<CreateTaskInput, "targetRepo"> & { targetRepo?: string },
  ): Promise<any> {
    return this.store.create({
      ...input,
      targetRepo: input.targetRepo ?? this.repo,
    });
  }

  retry(id: string): Promise<any> {
    return this.store.retry(id);
  }

  /** Drift-dedup rows for a spec (keyed by context_bundle.spec_path). */
  driftTasksForSpec(
    taskType: string,
    specPath: string,
  ): Promise<DriftTaskRow[]> {
    return this.store.driftTasksForSpec(this.repo, taskType, specPath);
  }

  /** Open (per statuses) tasks of one type whose description starts with the prefix — job dedup. */
  findOpenLike(
    input: Omit<FindOpenLikeInput, "repo"> & { repo?: string },
  ): Promise<PipelineTask[]> {
    return this.store.findOpenLike({ ...input, repo: input.repo ?? this.repo });
  }

  list(status?: string, limit?: number): Promise<TaskListResult> {
    return this.store.list(status, limit);
  }

  getWithEvents(id: string): Promise<TaskWithEvents | null> {
    return this.store.getWithEvents(id);
  }

  setStatus(
    id: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    return this.store.setStatus(id, status, extra);
  }

  setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<boolean> {
    return this.store.setStatusIf(id, expectedStatus, status, extra);
  }

  updateStatus(id: string, status: string, meta?: unknown): Promise<void> {
    return this.store.updateStatus(id, status, meta);
  }

  recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: unknown,
  ): Promise<void> {
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
