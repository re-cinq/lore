import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.task_events` — one status transition of a task; `fromStatus` is null on the creation row, making the trail replayable from nothing rather than from the first change. */

export const TaskEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.date(),
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;

export const TASK_EVENT_COLUMNS = {
  id: "id",
  taskId: "task_id",
  fromStatus: "from_status",
  toStatus: "to_status",
  metadata: "metadata",
  createdAt: "created_at",
} as const satisfies ColumnMap<TaskEvent>;

export const TASK_EVENT_TABLE = "pipeline.task_events";
