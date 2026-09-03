import { enforceTrue } from "../../lib/enforce.js";
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
  groupRunsByFile,
  mapWithLimit,
  type TestDescriptor,
  type RunResult,
  type TestCommandManifest,
} from "../../index.js";
import type { TestRunnerPort, TestRunReport } from "./test-runner-port.js";

const execShell = promisify(exec);
// Default timeout: 120s; override with LORE_TRACE_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = Number(process.env.LORE_TRACE_TIMEOUT_MS) || 120_000;
/** Max test files run concurrently by `report` — bounds per-file processes so the suite can't fork-bomb. */
const REPORT_CONCURRENCY = 4;

/** Single source for list command (adapter + mcp spec-trace-tools). */
export async function runTestsList(
  listCommand: string,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TestDescriptor[]> {
  const { stdout } = await execShell(listCommand, { cwd, timeout: timeoutMs });

  return parseTestDescriptors(parseCommandJson(stdout, "tests.list"));
}

/** Run the manifest `run` command for one selector and parse the result. */
export async function runTestsRun(
  runCommand: string,
  selector: string,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RunResult> {
  const { stdout } = await execShell(substituteSelector(runCommand, selector), {
    cwd,
    timeout: timeoutMs,
  });

  return parseRunResult(parseCommandJson(stdout, "tests.run"));
}

export function parseCommandJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      `${what} command did not emit valid JSON: ${stdout.slice(0, 200)}`,
    );
  }
}

/** TestRunnerPort over .lore/test-commands.yml; trust gate on TestSuite facade. */
export class ExecTestRunner implements TestRunnerPort {
  listTests(cwd: string): Promise<TestDescriptor[]> {
    const manifest = loadManifest(cwd);

    enforceTrue(
      manifest.list,
      Error,
      "test-command manifest entry has no 'list' command; it runs whole and cannot enumerate tests",
    );

    return runTestsList(manifest.list, resolveCwd(manifest, cwd));
  }

  runTest(cwd: string, selector: string): Promise<RunResult> {
    const manifest = loadManifest(cwd);

    return runTestsRun(manifest.run, selector, resolveCwd(manifest, cwd));
  }

  async report(
    cwd: string,
    concurrency = REPORT_CONCURRENCY,
  ): Promise<TestRunReport> {
    const tests = await this.listTests(cwd);
    // Coverage/run is file-level; run each file once, fan result to all descriptors.
    const byFile = groupRunsByFile(tests);
    const files = [...byFile.keys()];
    const fileResults = await mapWithLimit(files, concurrency, (file) =>
      this.runTest(cwd, file),
    );
    const resultByFile = new Map(
      files.map((file, index) => [file, fileResults[index]]),
    );
    const results: RunResult[] = [];

    for (const [file, ids] of byFile) {
      const run = resultByFile.get(file)!;

      results.push(...ids.map(() => run));
    }
    const passed = results.filter((r) => r.passed).length;

    return { passed, failed: results.length - passed, results };
  }
}

function loadManifest(cwd: string): TestCommandManifest {
  const file = join(cwd, ".lore", "test-commands.yml");

  enforceTrue(existsSync(file), Error, `No test-command manifest at ${file}`);
  const manifests = resolveTestCommandManifest({
    file: parse(readFileSync(file, "utf8")),
  });

  enforceTrue(
    !(!manifests || manifests.length === 0),
    Error,
    `No usable test-command manifest in ${file}`,
  );

  return manifests[0];
}

function resolveCwd(manifest: TestCommandManifest, cwd: string): string {
  return join(cwd, manifest.cwd || ".");
}
