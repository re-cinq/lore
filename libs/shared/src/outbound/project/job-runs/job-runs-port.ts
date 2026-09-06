/** One pipeline.job_runs row: scheduled-job invocation lifecycle (started → completed/failed) with optional log pointer. */
export interface JobRunRecord {
  startedAt: Date;
}

/** Scheduled-job run-history surface; Floor scheduler records invocations, decides due via last started_at, routes through Project facade not kernel query. */
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
