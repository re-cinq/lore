// The ingest-side door for test runs and source files: a default-branch test report and a code delta are pushed to the repo's Utopia source when it has one, a failed item failing the ingest so it is logged and counted.

import type { TestReportInput } from "@re-cinq/lore-shared/utopia/test-report-statements.js";
import {
  mirrorTestReport,
  tombstoneTestFiles,
} from "@re-cinq/lore-shared/utopia/mirror-test-report.js";
import {
  mirrorCodeFiles,
  tombstoneCodeFiles,
  type CodeDeltaInput,
} from "@re-cinq/lore-shared/utopia/mirror-code.js";
import { mirrorDepsFor, settled } from "../repo-mirror.js";

/** A test report as the delta route received it, and the commit the delta names. */
export interface MirroredReport {
  report: unknown;
  commit: string;
}

/** A code delta's files as the delta route received them, and the commit the delta names. */
export type MirroredCode = Omit<CodeDeltaInput, "repo">;

export async function mirrorReportFor(
  repo: string,
  { report, commit }: MirroredReport,
): Promise<void> {
  const run = { repo, commit, ...reportRuns(report) };
  const deps = run.tests.length > 0 ? await mirrorDepsFor(repo) : null;

  if (deps) {
    settled(await mirrorTestReport(deps, run));
  }
}

export async function unmirrorTestFilesFor(
  repo: string,
  paths: string[],
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await tombstoneTestFiles(deps, paths));
  }
}

export async function mirrorCodeFor(
  repo: string,
  code: MirroredCode,
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await mirrorCodeFiles(deps, { repo, ...code }));
  }
}

export async function unmirrorCodeFor(
  repo: string,
  paths: string[],
): Promise<void> {
  const deps = await mirrorDepsFor(repo);

  if (deps) {
    settled(await tombstoneCodeFiles(deps, paths));
  }
}

/** The descriptors and results of a report the route took as unknown; a report missing either list mirrors without it. */
function reportRuns(
  report: unknown,
): Pick<TestReportInput, "tests" | "results"> {
  const { tests, results } = (report ?? {}) as Record<string, unknown>;

  return {
    tests: Array.isArray(tests) ? tests : [],
    results: Array.isArray(results) ? results : [],
  };
}
