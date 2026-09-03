import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.task_leases` — the per-branch lease keeping two workers off one branch (FR1.6); BRANCH is the primary key, not the task, making it a claim on the working surface. */

export const TaskLeaseSchema = z.object({
  branchName: z.string(),
  taskId: z.string().nullable(),
  holder: z.string(),
  acquiredAt: z.date(),
  expiresAt: z.date(),
  phase: z.string().nullable(),
});

export type TaskLease = z.infer<typeof TaskLeaseSchema>;

export const TASK_LEASE_COLUMNS = {
  branchName: "branch_name",
  taskId: "task_id",
  holder: "holder",
  acquiredAt: "acquired_at",
  expiresAt: "expires_at",
  phase: "phase",
} as const satisfies ColumnMap<TaskLease>;

export const TASK_LEASE_TABLE = "pipeline.task_leases";
