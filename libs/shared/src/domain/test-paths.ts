// `.spec.` is deliberately left un-tightened: narrowing it risks regressing `foo.spec.ts` detection.
const TEST_PATH_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /_test\./,
  /(^|\/)__tests__\//,
  /_test\.go$/,
  /_test\.rs$/,
  /(^|\/)test_[^/]*\.py$/,
  /Tests?\.(java|kt)$/,
  /_spec\.rb$/,
  /Tests?\.cs$/,
  /Test\.php$/,
];

/** The same conventions as one Postgres regex (every pattern above is also a valid ARE), so a query can keep only test files instead of shipping a repo's whole codebase to be filtered afterwards. */
export const TEST_PATH_SQL_PATTERN = TEST_PATH_PATTERNS.map(
  (pattern) => pattern.source,
).join("|");

export function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

const DOC_PATH_PATTERN = /\.(md|markdown|mdx|txt|rst|adoc)$/i;

export function isDocFile(filePath: string): boolean {
  return DOC_PATH_PATTERN.test(filePath);
}

export function normalizeTestName(describe: string, it: string): string {
  const collapse = (segment: string) =>
    segment.trim().replace(/\s+/g, " ").toLowerCase();

  return [describe, it]
    .map(collapse)
    .filter((segment) => segment.length > 0)
    .join(" › ");
}
