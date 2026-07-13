import type { EvalRunsPort, EvalRun, EvalRunSample } from "./evals-port.js";

/**
 * In-memory {@link EvalRunsPort}: keeps every recorded run for test assertions
 * and serves `recent` from them newest-first (insertion order is the run
 * order). The double for the eval-runner regression check and the autoresearch
 * baseline read, so they stay testable without a live `pipeline.eval_runs`.
 */
export class InMemoryEvalRuns implements EvalRunsPort {
  readonly runs: EvalRun[] = [];

  async record(run: EvalRun): Promise<void> {
    this.runs.push(run);
  }

  async recent(
    team: string,
    limit: number,
    offset = 0,
  ): Promise<EvalRunSample[]> {
    return this.runs
      .filter((run) => run.team === team)
      .reverse()
      .slice(offset, offset + limit)
      .map((run) => ({ pass_rate: run.pass_rate }));
  }
}
