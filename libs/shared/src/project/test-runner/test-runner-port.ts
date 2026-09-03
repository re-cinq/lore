import type { TestDescriptor, RunResult } from "../../test-report.js";

/** Test discovery/execution port; execution trust-gated by facade. */

export interface TestRunReport {
  passed: number;
  failed: number;
  results: RunResult[];
}

export interface TestRunnerPort {
  listTests(cwd: string): Promise<TestDescriptor[]>;
  runTest(cwd: string, selector: string): Promise<RunResult>;
  report(cwd: string): Promise<TestRunReport>;
}
