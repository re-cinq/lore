import type { PgPool } from "../../memory-store.js";
import type { JobRunsPort, JobRunRecord } from "./job-runs-port.js";

/**
 * Postgres-backed {@link JobRunsPort}: the INSERT + two UPDATEs + last-run
 * SELECT lifted verbatim from the Floor scheduler's `job-run.ts` /
 * `scheduler.ts`, so the scheduler reaches `pipeline.job_runs` through the
 * Project facade instead of a kernel `query`.
 */
export class PgJobRuns implements JobRunsPort {
  constructor(private readonly pool: PgPool) {}

  async start(jobName: string): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.job_runs (job_name, status)
     VALUES ($1, 'running') RETURNING id`,
      [jobName],
    );

    return rows[0].id;
  }

  async complete(
    runId: string,
    resultSummary: string,
    logPath?: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.job_runs
     SET completed_at = now(),
         status = 'completed',
         result_summary = $1,
         log_path = $2
     WHERE id = $3`,
      [resultSummary, logPath ?? null, runId],
    );
  }

  async fail(runId: string, error: string, logPath?: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.job_runs
     SET completed_at = now(),
         status = 'failed',
         error = $1,
         log_path = $2
     WHERE id = $3`,
      [error, logPath ?? null, runId],
    );
  }

  async lastRun(jobName: string): Promise<JobRunRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT started_at FROM pipeline.job_runs
         WHERE job_name = $1
         ORDER BY started_at DESC LIMIT 1`,
      [jobName],
    );

    if (rows.length === 0) {
      return null;
    }

    return { startedAt: rows[0].started_at };
  }
}
