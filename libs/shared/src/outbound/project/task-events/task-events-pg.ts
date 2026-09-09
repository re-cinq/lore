import type { PgPool } from "../../memory-store.js";
import { fromRow, selectList } from "../../../lib/row.js";
import {
  TASK_EVENT_COLUMNS,
  TASK_EVENT_TABLE,
  type TaskEvent,
} from "../../../domain/models/task-event.js";
import type { TaskEventsRepository } from "./task-events-port.js";

const SELECT_COLUMNS = selectList(TASK_EVENT_COLUMNS);

/** The driver hands `id` back as a bigint string already; the model wants it as a string regardless of driver settings. */
function toRow(row: Record<string, unknown>): TaskEvent {
  const event = fromRow<TaskEvent>(TASK_EVENT_COLUMNS, row);

  return { ...event, id: String(event.id) };
}

export class PgTaskEvents implements TaskEventsRepository {
  constructor(private readonly pool: PgPool) {}

  async listForTask(taskId: string): Promise<TaskEvent[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM ${TASK_EVENT_TABLE}
        WHERE task_id = $1 ORDER BY created_at, id`,
      [taskId],
    );

    return rows.map(toRow);
  }
}
