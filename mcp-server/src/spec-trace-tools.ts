/**
 * Test-interface plumbing for the `list_tests` / `run_test` MCP tools.
 * `executionRefusal` is the trust-boundary gate (test commands run only
 * in a local sandbox, never on a cluster instance with `LORE_DB_HOST`
 * set). `runTestsList` and `runTestsRun` execute the repo's manifest
 * commands through a shell — each invocation is timeout-bounded, so a
 * runaway command is killed and the call rejects — and hand stdout to
 * the shared `parseTestDescriptors` / `parseRunResult` parsers.
 * `loadTestCommandManifest` reads `<repoRoot>/.lore/test-commands.yml`.
 * `listTestsTool` / `runTestTool` are the orchestrators the tool
 * registrations call: gate → manifest precondition → run → JSON.
 * `buildTestReport` is the full-suite orchestrator: it gates, lists,
 * runs every descriptor, and assembles the `/test-report` body.
 * See `specs/project-test-interface/contracts/test-commands.md`.
 */

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
  type CoveredChunk,
  type TaggedRunResult,
  type TestCommandManifest,
} from "@re-cinq/lore-shared";

const execShell = promisify(exec);

const NO_MANIFEST = "No test-command manifest declared for this repo.";

const DEFAULT_TIMEOUT_MS = 120_000;

function resolveCwd(manifest: TestCommandManifest, cwd: string): string {
  return join(cwd, manifest.cwd || ".");
}

export function stripPathPrefix(file: string, prefix: string): string {
  if (prefix && file.startsWith(prefix)) {
    return file.slice(prefix.length);
  }
  return file;
}

export function stripDescriptorPaths(
  descriptors: TestDescriptor[],
  prefix: string,
): TestDescriptor[] {
  return descriptors.map((descriptor) => ({
    ...descriptor,
    file: stripPathPrefix(descriptor.file, prefix),
  }));
}

export function stripCoveredPaths(result: RunResult, prefix: string): RunResult {
  return {
    ...result,
    covered: result.covered.map((chunk: CoveredChunk) => ({
      ...chunk,
      file: stripPathPrefix(chunk.file, prefix),
    })),
  };
}

export function executionRefusal(env: NodeJS.ProcessEnv): string | null {
  return env.LORE_DB_HOST
    ? "Test commands run only in a trusted sandbox — run in CI or locally."
    : null;
}

export function parseCommandJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${what} command did not emit valid JSON: ${stdout.slice(0, 200)}`);
  }
}

export async function runTestsList(
  listCommand: string,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TestDescriptor[]> {
  const { stdout } = await execShell(listCommand, { cwd, timeout: timeoutMs });

  /// TODO: return an xml format list and error that is interpreded better by the ai models
  return parseTestDescriptors(parseCommandJson(stdout, "tests.list"));
}

export async function runTestsRun(
  runCommand: string,
  selector: string,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RunResult> {
  const { stdout } = await execShell(substituteSelector(runCommand, selector), { cwd, timeout: timeoutMs });
  return parseRunResult(parseCommandJson(stdout, "tests.run"));
}

export async function listTestsTool(
  env: NodeJS.ProcessEnv,
  manifest: TestCommandManifest | null,
  cwd: string,
): Promise<string> {
  const refusal = executionRefusal(env);
  if (refusal) return refusal;

  if (!manifest) return NO_MANIFEST;

  const descriptors = await runTestsList(manifest.list, resolveCwd(manifest, cwd));
  return JSON.stringify(stripDescriptorPaths(descriptors, manifest.path_prefix_strip));
}

export async function runTestTool(
  env: NodeJS.ProcessEnv,
  manifest: TestCommandManifest | null,
  selector: string,
  cwd: string,
): Promise<string> {
  const refusal = executionRefusal(env);
  if (refusal) return refusal;

  if (!manifest) return NO_MANIFEST;

  const result = await runTestsRun(manifest.run, selector, resolveCwd(manifest, cwd));
  return JSON.stringify(stripCoveredPaths(result, manifest.path_prefix_strip));
}

interface TestReport {
  commit: string;
  branch: string;
  tests: TestDescriptor[];
  results: TaggedRunResult[];
}

export async function buildTestReport(
  env: NodeJS.ProcessEnv,
  manifest: TestCommandManifest,
  cwd: string,
  meta: { commit: string; branch: string },
): Promise<TestReport> {
  const refusal = executionRefusal(env);
  if (refusal) throw new Error(refusal);
  const runCwd = resolveCwd(manifest, cwd);
  const prefix = manifest.path_prefix_strip;
  const tests = stripDescriptorPaths(await runTestsList(manifest.list, runCwd), prefix);

  const runOrSkip = (descriptor: TestDescriptor) =>
    runTestsRun(manifest.run, descriptor.id, runCwd)
      .then((run) => ({
        id: descriptor.id,
        ...stripCoveredPaths(run, prefix),
      }))
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[trace] skipping ${descriptor.id}: ${reason}`);
        return null;
      });

  const settled = await Promise.all(tests.map(runOrSkip));
  const results = settled.filter((run) => run !== null);
  return { commit: meta.commit, branch: meta.branch, tests, results };
}

export function loadTestCommandManifest(repoRoot: string): TestCommandManifest | null {
  const manifestPath = join(repoRoot, ".lore", "test-commands.yml");
  if (!existsSync(manifestPath)) return null;

  const parsed = parse(readFileSync(manifestPath, "utf-8"));
  const resolved = resolveTestCommandManifest({ file: parsed });
  return resolved?.[0] ?? null;
}
