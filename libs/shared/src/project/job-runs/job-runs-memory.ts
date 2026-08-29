import type { JobRunsPort, JobRunRecord } from "./job-runs-port.js";
import type { JobRun } from "../../models/job-run.js";

/**
 * A full in-memory `pipeline.job_runs` row for behavioral assertions.
 *
 * The MODEL, not a copy of it. The double restated all eight fields, which is
 * how a double comes to agree with a shape the table no longer has.
 */
export type JobRunRow = JobRun;

/**
 * In-memory {@link JobRunsPort}: keeps every run row so the scheduler's
 * start/complete/fail/last-run flow stays testable without a live
 * `pipeline.job_runs`. Seed `rows` directly to drive `lastRun` assertions.
 */
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
