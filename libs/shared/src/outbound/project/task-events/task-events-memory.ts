import type { TaskEvent, TaskEventsRepository } from "./task-events-port.js";

export type NewTaskEvent = Omit<TaskEvent, "id" | "createdAt"> & {
  createdAt?: Date;
};

/** In-memory {@link TaskEventsRepository}: rows keep insertion order, which is the Pg `ORDER BY created_at, id` for rows written in time order. */
export class InMemoryTaskEvents implements TaskEventsRepository {
  readonly rows: TaskEvent[] = [];
  private nextId = 1;

  record(event: NewTaskEvent): TaskEvent {
    const row: TaskEvent = {
      ...event,
      id: String(this.nextId++),
      createdAt: event.createdAt ?? new Date(),
    };

    this.rows.push(row);

    return row;
  }

  async listForTask(taskId: string): Promise<TaskEvent[]> {
    return this.rows.filter((row) => row.taskId === taskId);
  }
}
