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
// A full-suite `list` (and large per-file `run`s) can outrun a tight ceiling on
// cold CI runners. Override with LORE_TRACE_TIMEOUT_MS; default stays 120s.
const DEFAULT_TIMEOUT_MS = Number(process.env.LORE_TRACE_TIMEOUT_MS) || 120_000;
/** Max test files run concurrently by `report` — bounds per-file processes so the suite can't fork-bomb. */
const REPORT_CONCURRENCY = 4;

/** Run the manifest `list` command and parse its descriptors. Single source for
 *  both this adapter and mcp's spec-trace-tools (which re-exports it). */
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

/**
 * TestRunnerPort over the repo's .lore/test-commands.yml — relocated from
 * mcp-server/src/spec-trace-tools.ts (runTestsList/runTestsRun/buildTestReport).
 * The trust gate lives on the TestSuite facade; this just runs the commands.
 */
export class ExecTestRunner implements TestRunnerPort {
  listTests(cwd: string): Promise<TestDescriptor[]> {
    const manifest = loadManifest(cwd);
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
    // Coverage/run is file-level: run each file ONCE (selector = file) under a
    // concurrency cap, then fan its result to every descriptor sharing the file.
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
      for (let i = 0; i < ids.length; i += 1) results.push(run);
    }
    const passed = results.filter((r) => r.passed).length;
    return { passed, failed: results.length - passed, results };
  }
}

function loadManifest(cwd: string): TestCommandManifest {
  const file = join(cwd, ".lore", "test-commands.yml");
  if (!existsSync(file)) {
    throw new Error(`No test-command manifest at ${file}`);
  }
  const manifests = resolveTestCommandManifest({
    file: parse(readFileSync(file, "utf8")),
  });
  if (!manifests || manifests.length === 0) {
    throw new Error(`No usable test-command manifest in ${file}`);
  }
  return manifests[0];
}

function resolveCwd(manifest: TestCommandManifest, cwd: string): string {
  return join(cwd, manifest.cwd || ".");
}
