/** Which tests a change affects, for the project-test-interface's `related` command: the module graph answers for source, and these paths answer for everything. */
import { minimatch } from "minimatch";

/** Paths that change how every test runs without any test importing them: the dependency tree, the vitest config and its shared helpers, and the manifest and scripts that run the suite. */
const EVERY_TEST_PATHS = [
  "**/package-lock.json",
  "**/vitest.config.*",
  "tools/vitest/**",
  ".lore/test-commands.yml",
  "libs/shared/scripts/trace/**",
];

/** True when a change since the ingested commit reaches every test, so the run must cover the whole suite rather than the files the module graph names. */
export function reachesEveryTest(changedPaths: string[]): boolean {
  return changedPaths.some((path) =>
    EVERY_TEST_PATHS.some((pattern) => minimatch(path, pattern, { dot: true })),
  );
}
