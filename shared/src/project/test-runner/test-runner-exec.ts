import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  parseTestDescriptors,
  parseRunResult,
  substituteSelector,
  resolveTestCommandManifest,
  type TestDescriptor,
  type RunResult,
  type TestCommandManifest,
} from "../../index.js";
import type { TestRunnerPort, TestRunReport } from "./test-runner-port.js";

const execShell = promisify(exec);
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * TestRunnerPort over the repo's .lore/test-commands.yml — relocated from
 * mcp-server/src/spec-trace-tools.ts (runTestsList/runTestsRun/buildTestReport).
 * The trust gate lives on the TestSuite facade; this just runs the commands.
 */
export class ExecTestRunner implements TestRunnerPort {
  async listTests(cwd: string): Promise<TestDescriptor[]> {
    const manifest = loadManifest(cwd);
    const { stdout } = await execShell(manifest.list, { cwd: resolveCwd(manifest, cwd), timeout: DEFAULT_TIMEOUT_MS });
    return parseTestDescriptors(parseCommandJson(stdout, "tests.list"));
  }

  async runTest(cwd: string, selector: string): Promise<RunResult> {
    const manifest = loadManifest(cwd);
    const command = substituteSelector(manifest.run, selector);
    const { stdout } = await execShell(command, { cwd: resolveCwd(manifest, cwd), timeout: DEFAULT_TIMEOUT_MS });
    return parseRunResult(parseCommandJson(stdout, "tests.run"));
  }

  async report(cwd: string): Promise<TestRunReport> {
    const tests = await this.listTests(cwd);
    const results = await Promise.all(tests.map((t) => this.runTest(cwd, t.id)));
    const passed = results.filter((r) => r.passed).length;
    return { passed, failed: results.length - passed, results };
  }
}

function loadManifest(cwd: string): TestCommandManifest {
  const file = join(cwd, ".lore", "test-commands.yml");
  if (!existsSync(file)) {
    throw new Error(`No test-command manifest at ${file}`);
  }
  const manifests = resolveTestCommandManifest({ file: parse(readFileSync(file, "utf8")) });
  if (!manifests || manifests.length === 0) {
    throw new Error(`No usable test-command manifest in ${file}`);
  }
  return manifests[0];
}

function resolveCwd(manifest: TestCommandManifest, cwd: string): string {
  return join(cwd, manifest.cwd || ".");
}

function parseCommandJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${what} command did not emit valid JSON: ${stdout.slice(0, 200)}`);
  }
}
