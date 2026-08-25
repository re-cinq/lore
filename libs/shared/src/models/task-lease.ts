import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.task_leases` — the per-branch lease that keeps two workers off one
 * branch (FR1.6).
 *
 * DDL: `scripts/infra/setup-dark-factory-schema.sh`; `task_id` was made
 * nullable by migration `0026` so a detection run with no task can hold one.
 * The BRANCH is the primary key, not the task — that is what makes the lease a
 * claim on the working surface rather than on the work item.
 */

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
