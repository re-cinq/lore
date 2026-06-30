import type { PgPool } from "../../memory-store.js";
import type { EvalRunsPort, EvalRun, EvalRunSample } from "./evals-port.js";

/**
 * Postgres-backed {@link EvalRunsPort}: a single INSERT into
 * `pipeline.eval_runs` and a `pass_rate` read ordered by `run_at DESC`.
 * Relocated from the eval-runner / autoresearch jobs so eval bookkeeping
 * reaches the table through the Project facade.
 */
export class PgEvalRuns implements EvalRunsPort {
  constructor(private readonly pool: PgPool) {}

  async record(run: EvalRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.eval_runs (team, pass_rate, total_tests, passed, failed)
       VALUES ($1, $2, $3, $4, $5)`,
      [run.team, run.pass_rate, run.total_tests, run.passed, run.failed],
    );
  }

  async recent(team: string, limit: number, offset = 0): Promise<EvalRunSample[]> {
    const { rows } = await this.pool.query(
      `SELECT pass_rate FROM pipeline.eval_runs
       WHERE team = $1
       ORDER BY run_at DESC
       OFFSET $2 LIMIT $3`,
      [team, offset, limit],
    );
    return rows.map((row) => ({ pass_rate: row.pass_rate }));
  }
}
