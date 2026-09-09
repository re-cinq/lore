/** One row in pipeline.eval_runs: pass-rate snapshot written by nightly eval-runner. */
export interface EvalRun {
  team: string;
  pass_rate: number;
  total_tests: number;
  passed: number;
  failed: number;
}

/** Pass-rate sample from pipeline.eval_runs for regression check and autoresearch baseline. */
export interface EvalRunSample {
  pass_rate: number;
}

/** Org-wide surface for eval-run bookkeeping: record results, read for regression/baseline. */
export interface EvalRunsPort {
  record(run: EvalRun): Promise<void>;
  recent(
    team: string,
    limit: number,
    offset?: number,
  ): Promise<EvalRunSample[]>;
}
