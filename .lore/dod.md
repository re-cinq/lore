# Definition of Done

> Rust tests declared with #[test] in non-test-named files receive the agreed classification without misclassifying production code.

**Strategy: `direct`** — The seam already exists. The acceptance test can call the real entry points today (`isTestFile` and `classifyFile`) and fail on behaviour.

## Done when these pass

- [ ] **identifies a Rust file containing the test attribute as a test file even if its name is not test-like** — returns true for `isTestFile` when content contains `#[test]`
  `libs/shared/src/domain/test-paths-rust.acceptance.test.ts`
- [ ] **does not identify a regular Rust file without the test attribute as a test file** — returns false for `isTestFile` when content lacks `#[test]`
  `libs/shared/src/domain/test-paths-rust.acceptance.test.ts`
- [ ] **receives the agreed classification as a test** — returns "test" for `classifyFile` when a Rust file contains `#[test]`
  `libs/shared/src/domain/test-paths-rust.acceptance.test.ts`
- [ ] **does not misclassify production code** — returns "code" for `classifyFile` when a Rust file lacks `#[test]`
  `libs/shared/src/domain/test-paths-rust.acceptance.test.ts`

## Facets

- [x] Update `isTestFile` signature to optionally accept content and implement Rust detection logic.
- [x] Update `classifyFile` signature to optionally accept content and forward it to `isTestFile`.

## Out of scope

- Updating ingestion architecture to read and pipe content from git to `classifyFile` if not already present in memory.
