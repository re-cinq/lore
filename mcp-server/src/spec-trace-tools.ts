/**
 * Test-interface command runners for the `list_tests` / `run_test` MCP
 * tools. `executionRefusal` is the trust-boundary gate (test commands
 * run only in a local sandbox, never on a cluster instance with
 * `LORE_DB_HOST` set). `runTestsList` and `runTestsRun` execute the
 * repo's manifest commands through a shell and hand stdout to the
 * shared `parseTestDescriptors` / `parseRunResult` parsers. The gate and
 * the runners are the composable pieces the upcoming tool orchestrators
 * compose. See `specs/project-test-interface/contracts/test-commands.md`.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  parseTestDescriptors,
  parseRunResult,
  substituteSelector,
  type TestDescriptor,
  type RunResult,
  type TestCommandManifest,
} from "@re-cinq/lore-shared";

const execShell = promisify(exec);

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

  if (!manifest) return "No test-command manifest declared for this repo.";

  const descriptors = await runTestsList(manifest.list, manifest.cwd || cwd);
  return JSON.stringify(descriptors);
}
