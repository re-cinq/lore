import type { TaskEvent } from "../../../domain/models/task-event.js";

export type { TaskEvent };

/** `pipeline.task_events` read side: the status trail of one task, in the order it was written. Writes stay on `TaskStorePort.recordEvent`. */
export interface TaskEventsRepository {
  /** Every transition of the task, oldest first; `id` is a string-encoded bigint. */
  listForTask(taskId: string): Promise<TaskEvent[]>;
}
