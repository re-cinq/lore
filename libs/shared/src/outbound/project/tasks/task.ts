import type {
  PipelineTask,
  TaskStatus,
  TaskType,
} from "../../../domain/types.js";
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

  /** The backlog issue the task works on; null when it has none. */
  get issueNumber(): number | null {
    return this.row.issue_number ?? null;
  }

  /** The task group this task belongs to; null when ungrouped. */
  get taskGroupId(): string | null {
    return this.row.task_group_id ?? null;
  }

  /** Context bundle stored on the task; null when none. */
  get contextBundle(): Record<string, unknown> | null {
    return this.row.context_bundle ?? null;
  }

  /** Failure reason; planning poll shows this even when iteration stuck at running. */
  get failureReason(): string | null {
    return this.row.failure_reason ?? null;
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
