import type { PipelineTask, TaskStatus, TaskType } from "../../types.js";
import type { TaskStorePort } from "./task-store-port.js";

/**
 * A single pipeline task. Wraps the row and re-reads it on each transition so
 * callers always see fresh status. The status/type unions come from the
 * existing shared types — no new vocabulary.
 */
export class Task {
  constructor(
    private row: PipelineTask,
    private readonly store: TaskStorePort,
  ) {}

  get id(): string {
    return this.row.id;
  }

  get type(): TaskType {
    return this.row.task_type as TaskType;
  }

  get status(): TaskStatus {
    return this.row.status as TaskStatus;
  }

  get prUrl(): string | undefined {
    return this.row.pr_url;
  }

  /** Why the task failed, when it did. The planning poll surfaces this so a hard
   *  crash that left the round's iteration at `running` still shows a failure and a
   *  retry rather than an endless spinner. */
  get failureReason(): string | null {
    return this.row.failure_reason ?? null;
  }

  async claim(agentId: string): Promise<this> {
    this.row = await this.store.transition(this.id, "claim", { agentId });

    return this;
  }

  async cancel(): Promise<this> {
    this.row = await this.store.transition(this.id, "cancel");

    return this;
  }

  async retry(): Promise<this> {
    this.row = await this.store.transition(this.id, "retry");

    return this;
  }
}
