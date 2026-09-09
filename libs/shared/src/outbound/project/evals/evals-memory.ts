import type { EvalRunsPort, EvalRun, EvalRunSample } from "./evals-port.js";

/** In-memory EvalRunsPort: records and serves eval runs newest-first for testing. */
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
