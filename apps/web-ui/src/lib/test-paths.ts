/**
 * In-sync mirror of `shared/src/test-paths.ts`. web-ui is not a
 * workspace member, so it can't import from `@re-cinq/lore-shared`
 * directly. Keep both copies in step. See web-ui/CLAUDE.md and the
 * comment on `lib/spec-summary.ts` for the established mirror pattern.
 */

// Anchoring policy: the trailing language patterns are extension-anchored
// (`...$`) so they only match at the end of a path. The substring patterns
// (`.test.`, `.spec.`, `_test.`) are intentionally path-position-agnostic —
// they match anywhere. `.spec.` is deliberately left un-tightened: narrowing
// it would risk regressing `foo.spec.ts` detection for no current payoff.
const TEST_PATH_PATTERNS = [
  /\.test\./, // foo.test.ts, foo.test.tsx
  /\.spec\./, // foo.spec.ts
  /_test\./, // foo_test.py
  /(^|\/)__tests__\//, // __tests__/foo.ts
  /_test\.go$/, // foo_test.go
  /_test\.rs$/, // foo_test.rs (explicit; also caught by _test. above)
  /(^|\/)test_[^/]*\.py$/, // pytest leading: test_user.py
  /Tests?\.(java|kt)$/, // JUnit / Kotlin: CalculatorTest(s).java|kt
  /_spec\.rb$/, // RSpec: user_spec.rb
  /Tests?\.cs$/, // .NET: CalculatorTest(s).cs
  /Test\.php$/, // PHP: CalculatorTest.php
];

export function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

const DOC_PATH_PATTERN = /\.(md|markdown|mdx|txt|rst|adoc)$/i;

/** True when a path is prose documentation (markdown, ADRs, plain text)
 * rather than source code. Used to keep doc/ADR links out of the
 * IMPLEMENTED_BY code-link set. */
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
