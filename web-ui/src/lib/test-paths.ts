/**
 * In-sync mirror of `shared/src/test-paths.ts`. web-ui is not a
 * workspace member, so it can't import from `@re-cinq/lore-shared`
 * directly. Keep both copies in step. See web-ui/CLAUDE.md and the
 * comment on `lib/spec-summary.ts` for the established mirror pattern.
 */

const TEST_PATH_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /_test\./,
  /(^|\/)__tests__\//,
  /_test\.go$/,
];

export function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function normalizeTestName(describe: string, it: string): string {
  const collapse = (segment: string) => segment.trim().replace(/\s+/g, " ").toLowerCase();
  return [describe, it]
    .map(collapse)
    .filter((segment) => segment.length > 0)
    .join(" › ");
}
