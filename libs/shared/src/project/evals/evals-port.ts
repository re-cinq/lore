/**
 * One row in `pipeline.eval_runs`. Written by the nightly eval-runner job
 * after a PromptFoo run, one per team, capturing the pass-rate snapshot the
 * regression check and autoresearch baseline read back.
 */
export interface EvalRun {
  team: string;
  pass_rate: number;
  total_tests: number;
  passed: number;
  failed: number;
}

/**
 * A pass-rate sample read back from `pipeline.eval_runs`. Both the regression
 * check (previous run) and the autoresearch baseline (latest run) only need
 * the `pass_rate` column.
 */
export interface EvalRunSample {
  pass_rate: number;
}

/**
 * The org-wide (repo-agnostic) eval-run surface. The eval-runner records each
 * team's PromptFoo result and reads the most recent samples back to detect
 * regressions; autoresearch reads the latest sample as its baseline. The
 * kernel reaches `pipeline.eval_runs` through here instead of a bespoke DB
 * writer.
 */
export interface EvalRunsPort {
  record(run: EvalRun): Promise<void>;
  recent(team: string, limit: number, offset?: number): Promise<EvalRunSample[]>;
}
