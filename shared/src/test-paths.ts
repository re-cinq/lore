/**
 * Path + name heuristics for tests. Used by:
 *   - agent's spec-test-linker to filter `content_type='code'` chunks
 *     down to candidate tests before the LLM judge runs
 *   - mcp-server's spec-coverage-prepare to compose the same candidate
 *     payload for the BYO-compute local linker
 *
 * Path-only — never reads file contents. Lives in shared so both
 * packages import the same source of truth and stay in lock-step.
 */

const TEST_PATH_PATTERNS = [
  /\.test\./, // foo.test.ts, foo.test.tsx
  /\.spec\./, // foo.spec.ts
  /_test\./, // foo_test.py
  /(^|\/)__tests__\//, // __tests__/foo.ts
  /_test\.go$/, // foo_test.go
  /(^|\/)test_[^/]*\.py$/, // pytest leading: test_user.py
  /Tests?\.(java|kt)$/, // JUnit / Kotlin: CalculatorTest(s).java|kt
  /_spec\.rb$/, // RSpec: user_spec.rb
  /Tests?\.cs$/, // .NET: CalculatorTest(s).cs
  /Test\.php$/, // PHP: CalculatorTest.php
];

/** True when a file path looks like a test file, by convention. */
export function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Normalizes a `describe > it` pair into a stable key for a single test case:
 * lowercased, whitespace-collapsed, joined with ` › `. This is the value
 * stored in `spec_test_links.test_name` and the unique-constraint component
 * that keeps re-runs from inserting duplicate rows for the same test.
 */
export function normalizeTestName(describe: string, it: string): string {
  const collapse = (segment: string) => segment.trim().replace(/\s+/g, " ").toLowerCase();
  return [describe, it]
    .map(collapse)
    .filter((segment) => segment.length > 0)
    .join(" › ");
}
