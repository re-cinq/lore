import type { JobRunsPort, JobRunRecord } from "./job-runs-port.js";
import type { JobRun } from "../../models/job-run.js";

/** Full in-memory pipeline.job_runs row for behavioral assertions; THE MODEL, double tracks table shape. */
export type JobRunRow = JobRun;

/** In-memory JobRunsPort: keeps every run row, testable without live pipeline.job_runs; seed rows directly for lastRun assertions. */
export class InMemoryJobRuns implements JobRunsPort {
  readonly rows: JobRunRow[] = [];
  private nextId = 1;

  async start(jobName: string): Promise<string> {
    const id = String(this.nextId++);

    this.rows.push({
      id,
      jobName,
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      resultSummary: null,
      error: null,
      logPath: null,
    });

    return id;
  }

  async complete(
    runId: string,
    resultSummary: string,
    logPath?: string,
  ): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === runId);

    // First-writer-wins, mirroring the Pg `completed_at IS NULL` guard.
    if (!row || row.completedAt) {
      return;
    }
    row.status = "completed";
    row.completedAt = new Date();
    row.resultSummary = resultSummary;
    row.logPath = logPath ?? null;
  }

  async fail(runId: string, error: string, logPath?: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === runId);

    if (!row || row.completedAt) {
      return;
    }
    row.status = "failed";
    row.completedAt = new Date();
    row.error = error;
    row.logPath = logPath ?? null;
  }

  async lastRun(jobName: string): Promise<JobRunRecord | null> {
    const matches = this.rows
      .filter((row) => row.jobName === jobName)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    if (matches.length === 0) {
      return null;
    }

    return { startedAt: matches[0].startedAt };
  }
}
