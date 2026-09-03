import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.log_access` — who read a task's logs, and from where; append-only by design (exists to answer "who saw this"). */

export const LogAccessSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  accessedAt: z.date(),
  ipAddress: z.string().nullable(),
});

export type LogAccess = z.infer<typeof LogAccessSchema>;

export const LOG_ACCESS_COLUMNS = {
  id: "id",
  taskId: "task_id",
  userId: "user_id",
  accessedAt: "accessed_at",
  ipAddress: "ip_address",
} as const satisfies ColumnMap<LogAccess>;

export const LOG_ACCESS_TABLE = "pipeline.log_access";
