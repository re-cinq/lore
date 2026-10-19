// Mirrors one test run into the repo's Utopia knowledge base: one item per test file, pushed as a document's items are, and a tombstone per deleted test file.

import {
  testFileTombstones,
  testReportItems,
  type TestReportInput,
} from "../../domain/utopia/test-report-statements.js";
import {
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "./mirror-document.js";

export function mirrorTestReport(
  deps: MirrorDeps,
  input: TestReportInput,
): Promise<MirrorOutcome> {
  return pushItems(deps, testReportItems(input));
}

export function tombstoneTestFiles(
  deps: MirrorDeps,
  paths: string[],
): Promise<MirrorOutcome> {
  return pushItems(deps, testFileTombstones(paths));
}
