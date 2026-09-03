// Test-interface plumbing for lore_list_tests/lore_run_test: executionRefusal gates to a local sandbox only (see specs/project-test-interface/contracts/test-commands.md).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  resolveTestCommandManifest,
  executionRefusal,
  type TestDescriptor,
  type RunResult,
  type CoveredChunk,
  type TestCommandManifest,
} from "@re-cinq/lore-shared";

// Relocated to @re-cinq/lore-shared (project/lib/trust.ts); re-exported here for back-compat with existing importers.
export { executionRefusal };

const NO_MANIFEST = "No test-command manifest declared for this repo.";
const NO_LIST_COMMAND =
  "This test-command manifest entry has no 'list' command; it runs whole and cannot enumerate tests.";

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

export function stripCoveredPaths(
  result: RunResult,
  prefix: string,
): RunResult {
  return {
    ...result,
    covered: result.covered.map((chunk: CoveredChunk) => ({
      ...chunk,
      file: stripPathPrefix(chunk.file, prefix),
    })),
  };
}

// runTestsList/runTestsRun/parseCommandJson are single-sourced in shared (also backing the ExecTestRunner adapter); imported for local use + re-exported for existing importers.
import {
  runTestsList,
  runTestsRun,
  parseCommandJson,
} from "@re-cinq/lore-shared/project/test-runner/test-runner-exec.js";

export { runTestsList, runTestsRun, parseCommandJson };

export async function listTestsTool(
  env: NodeJS.ProcessEnv,
  manifest: TestCommandManifest | null,
  cwd: string,
): Promise<string> {
  const refusal = executionRefusal(env);

  if (refusal) {
    return refusal;
  }

  if (!manifest) {
    return NO_MANIFEST;
  }

  if (!manifest.list) {
    return NO_LIST_COMMAND;
  }

  const descriptors = await runTestsList(
    manifest.list,
    resolveCwd(manifest, cwd),
  );

  return JSON.stringify(
    stripDescriptorPaths(descriptors, manifest.path_prefix_strip),
  );
}

export async function runTestTool(
  env: NodeJS.ProcessEnv,
  manifest: TestCommandManifest | null,
  selector: string,
  cwd: string,
): Promise<string> {
  const refusal = executionRefusal(env);

  if (refusal) {
    return refusal;
  }

  if (!manifest) {
    return NO_MANIFEST;
  }

  const result = await runTestsRun(
    manifest.run,
    selector,
    resolveCwd(manifest, cwd),
  );

  return JSON.stringify(stripCoveredPaths(result, manifest.path_prefix_strip));
}

export function loadTestCommandManifest(
  repoRoot: string,
): TestCommandManifest | null {
  const manifestPath = join(repoRoot, ".lore", "test-commands.yml");

  if (!existsSync(manifestPath)) {
    return null;
  }

  const parsed = parse(readFileSync(manifestPath, "utf-8"));
  const resolved = resolveTestCommandManifest({ file: parsed });

  return resolved?.[0] ?? null;
}
