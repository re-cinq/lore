import type { PgPool } from "../../memory-store.js";
import type { JobRunsPort, JobRunRecord } from "./job-runs-port.js";

/** Postgres-backed JobRunsPort; INSERT+UPDATE+SELECT from scheduler; FIRST-WRITER-WINS; finishLine before close (crash safe, racer safe). */
export class PgJobRuns implements JobRunsPort {
  constructor(private readonly pool: PgPool) {}

  async start(jobName: string): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO pipeline.job_runs (job_name, status)
     VALUES ($1, 'running') RETURNING id`,
      [jobName],
    );

    return rows[0].id as string;
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
     WHERE id = $3
       AND completed_at IS NULL`,
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
     WHERE id = $3
       AND completed_at IS NULL`,
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

    return { startedAt: rows[0].started_at as Date };
  }
}
