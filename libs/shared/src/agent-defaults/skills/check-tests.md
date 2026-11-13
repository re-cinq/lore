---
name: check-tests
description: Run tests only for files changed in current branch
argument-hint: "[base-branch]"
model: claude-haiku-4-5-20251001
context: fork
---

# Check Tests

Run tests only for files that changed in the current branch.

Usage: `/check-tests [base-branch]`; the base defaults to the repository's default branch.

1. List the changed files: `git diff --name-only <base>...HEAD`.
2. Detect the repo's test runner from its manifest (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, `Gemfile`, `mix.exs`) and its config. Use that runner; never install another.
3. Find the tests related to the changed files, using the runner's own mechanism (for example `vitest related`, `jest --findRelatedTests`, `go test` on the changed packages, `pytest` on the matching test files) or, failing that, the test files that sit beside the changed files or import them. Include changed test files themselves.
4. Run only those tests, never the whole suite.
5. Report the branch name, the changed files, passed and failed counts with the failure details, and every changed source file that has no test.

## Help

<!-- lore-help:begin -->
**Summary.** Run only the tests that relate to the files changed on the current branch.
**Usage:** `/check-tests [base-branch]`
**Use when.** You want quick test feedback on your branch without running the whole suite.
**Related:** `/tdd-loop`
<!-- lore-help:end -->
