/**
 * One row in `pipeline.job_runs` — a single scheduled-job invocation's
 * lifecycle (started → completed/failed) with an optional log pointer.
 * Written by the Floor scheduler around every cron-job handler run.
 */
export interface JobRunRecord {
  startedAt: Date;
}

/**
 * The scheduled-job run-history surface. The Floor scheduler records each
 * job invocation through here — start stamps a `running` row, complete/fail
 * close it — and reads the last `started_at` to decide whether a job is due.
 * Relocated out of the Floor so run accounting reaches the table through the
 * Project facade instead of a kernel `query` call.
 */
export interface JobRunsPort {
  start(jobName: string): Promise<string>;
  complete(
    runId: string,
    resultSummary: string,
    logPath?: string,
  ): Promise<void>;
  fail(runId: string, error: string, logPath?: string): Promise<void>;
  lastRun(jobName: string): Promise<JobRunRecord | null>;
}
