import type { PgPool } from "../../memory-store.js";
import type { EvalRunsPort, EvalRun, EvalRunSample } from "./evals-port.js";

/** Postgres-backed EvalRunsPort: inserts and reads pass_rate from pipeline.eval_runs. */
export class PgEvalRuns implements EvalRunsPort {
  constructor(private readonly pool: PgPool) {}

  async record(run: EvalRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.eval_runs (team, pass_rate, total_tests, passed, failed)
       VALUES ($1, $2, $3, $4, $5)`,
      [run.team, run.pass_rate, run.total_tests, run.passed, run.failed],
    );
  }

  async recent(
    team: string,
    limit: number,
    offset = 0,
  ): Promise<EvalRunSample[]> {
    const { rows } = await this.pool.query<{ pass_rate: number }>(
      `SELECT pass_rate FROM pipeline.eval_runs
       WHERE team = $1
       ORDER BY run_at DESC
       OFFSET $2 LIMIT $3`,
      [team, offset, limit],
    );

    return rows.map((row) => ({ pass_rate: row.pass_rate }));
  }
}
