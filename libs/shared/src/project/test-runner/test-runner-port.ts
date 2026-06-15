import type { TestDescriptor, RunResult } from "../../test-report.js";

/**
 * Test discovery/execution port. The adapter wraps the existing
 * spec-trace-tools helpers (runTestsList/runTestsRun/buildTestReport). Execution
 * is trust-gated by the facade before it ever reaches the port.
 */

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
