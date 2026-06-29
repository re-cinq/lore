import { query } from "../../kernel/db.js";

export interface JobRunOptions {
  logPath?: string;
}

export async function startJobRun(jobName: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO pipeline.job_runs (job_name, status)
     VALUES ($1, 'running') RETURNING id`,
    [jobName],
  );
  return rows[0].id;
}

export async function completeJobRun(
  runId: string,
  summary: string,
  opts: JobRunOptions = {},
): Promise<void> {
  await query(
    `UPDATE pipeline.job_runs
     SET completed_at = now(),
         status = 'completed',
         result_summary = $1,
         log_path = $2
     WHERE id = $3`,
    [summary, opts.logPath ?? null, runId],
  );
}

export async function failJobRun(
  runId: string,
  error: string,
  opts: JobRunOptions = {},
): Promise<void> {
  await query(
    `UPDATE pipeline.job_runs
     SET completed_at = now(),
         status = 'failed',
         error = $1,
         log_path = $2
     WHERE id = $3`,
    [error, opts.logPath ?? null, runId],
  );
}
