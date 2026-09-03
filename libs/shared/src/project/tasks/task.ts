import type { PipelineTask, TaskStatus, TaskType } from "../../types.js";
import type { TaskStorePort } from "./task-store-port.js";

/** Pipeline task wrapper; re-reads row on each transition for fresh status. */
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

  /** Failure reason; planning poll shows this even when iteration stuck at running. */
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
