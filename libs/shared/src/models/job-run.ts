import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.job_runs` — one scheduled-job invocation's lifecycle; Floor scheduler stamps a `running` row on start and closes it on completion or failure. */

/** What the scheduler writes; the column has no CHECK, so `status` stays TEXT rather than claim a union the database doesn't enforce. */
export const JobRunStatusSchema = z.enum(["running", "completed", "failed"]);

export const JobRunSchema = z.object({
  id: z.string(),
  jobName: z.string(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
  status: z.string(),
  resultSummary: z.string().nullable(),
  error: z.string().nullable(),
  logPath: z.string().nullable(),
});

export type JobRunStatus = z.infer<typeof JobRunStatusSchema>;
export type JobRun = z.infer<typeof JobRunSchema>;

export const JOB_RUN_COLUMNS = {
  id: "id",
  jobName: "job_name",
  startedAt: "started_at",
  completedAt: "completed_at",
  status: "status",
  resultSummary: "result_summary",
  error: "error",
  logPath: "log_path",
} as const satisfies ColumnMap<JobRun>;

export const JOB_RUN_TABLE = "pipeline.job_runs";
