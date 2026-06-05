/**
 * Test-interface plumbing for the `list_tests` / `run_test` MCP tools.
 * `executionRefusal` is the trust-boundary gate (test commands run only
 * in a local sandbox, never on a cluster instance with `LORE_DB_HOST`
 * set). `runTestsList` and `runTestsRun` execute the repo's manifest
 * commands through a shell and hand stdout to the shared
 * `parseTestDescriptors` / `parseRunResult` parsers.
 * `loadTestCommandManifest` reads `<repoRoot>/.lore/test-commands.yml`.
 * `listTestsTool` / `runTestTool` are the orchestrators the tool
 * registrations call: gate → manifest precondition → run → JSON.
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
  type TestCommandManifest,
} from "@re-cinq/lore-shared";

const execShell = promisify(exec);

const NO_MANIFEST = "No test-command manifest declared for this repo.";

export function executionRefusal(env: NodeJS.ProcessEnv): string | null {
  return env.LORE_DB_HOST
    ? "Test commands run only in a trusted sandbox — run in CI or locally."
    : null;
}

export async function runTestsList(listCommand: string, cwd: string): Promise<TestDescriptor[]> {
  const { stdout } = await execShell(listCommand, { cwd });

  /// TODO: return an xml format list and error that is interpreded better by the ai models
  return parseTestDescriptors(JSON.parse(stdout));
}

export async function runTestsRun(
  runCommand: string,
  selector: string,
  cwd: string,
): Promise<RunResult> {
  const { stdout } = await execShell(substituteSelector(runCommand, selector), { cwd });
  return parseRunResult(JSON.parse(stdout));
}

export async function listTestsTool(
  env: NodeJS.ProcessEnv,
  manifest: TestCommandManifest | null,
  cwd: string,
): Promise<string> {
  const refusal = executionRefusal(env);
  if (refusal) return refusal;

  if (!manifest) return NO_MANIFEST;

  const descriptors = await runTestsList(manifest.list, manifest.cwd || cwd);
  return JSON.stringify(descriptors);
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

  const result = await runTestsRun(manifest.run, selector, manifest.cwd || cwd);
  return JSON.stringify(result);
}

export function loadTestCommandManifest(repoRoot: string): TestCommandManifest | null {
  const manifestPath = join(repoRoot, ".lore", "test-commands.yml");
  if (!existsSync(manifestPath)) return null;

  const parsed = parse(readFileSync(manifestPath, "utf-8"));
  const resolved = resolveTestCommandManifest({ file: parsed });
  return resolved?.[0] ?? null;
}
