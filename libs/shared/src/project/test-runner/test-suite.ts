import type { TestDescriptor, RunResult } from "../../test-report.js";
import type { TestRunnerPort, TestRunReport } from "./test-runner-port.js";
import { executionRefusal } from "../lib/trust.js";

/**
 * project.tests — test discovery/run/report, trust-gated. On the shared GKE
 * server (LORE_DB_HOST set) every operation refuses before touching the port;
 * in a trusted sandbox it delegates to the ExecTestRunner.
 */
export class TestSuite {
  constructor(
    private readonly runner: TestRunnerPort,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async listTests(cwd: string): Promise<TestDescriptor[]> {
    this.gate();

    return this.runner.listTests(cwd);
  }

  async runTest(cwd: string, selector: string): Promise<RunResult> {
    this.gate();

    return this.runner.runTest(cwd, selector);
  }

  async report(cwd: string): Promise<TestRunReport> {
    this.gate();

    return this.runner.report(cwd);
  }

  private gate(): void {
    const refusal = executionRefusal(this.env);

    if (refusal) {
      throw new Error(refusal);
    }
  }
}
