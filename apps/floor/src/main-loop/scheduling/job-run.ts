import type { JobRunsPort } from "@re-cinq/lore-shared/project/job-runs/job-runs-port.js";
import { jobRuns } from "../../kernel/queues.js";

export interface JobRunOptions {
  logPath?: string;
}

export function startJobRun(
  jobName: string,
  runs: JobRunsPort = jobRuns(),
): Promise<string> {
  return runs.start(jobName);
}

export function completeJobRun(
  runId: string,
  summary: string,
  opts: JobRunOptions = {},
  runs: JobRunsPort = jobRuns(),
): Promise<void> {
  return runs.complete(runId, summary, opts.logPath);
}

export function failJobRun(
  runId: string,
  error: string,
  opts: JobRunOptions = {},
  runs: JobRunsPort = jobRuns(),
): Promise<void> {
  return runs.fail(runId, error, opts.logPath);
}
