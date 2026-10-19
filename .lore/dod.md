# Definition of Done

> Three test suites went unrun this week because no CI job was configured for them—including critical registry guards.

**Strategy: `parallel-change`** — no seam exists for a missing CI check, so the test expects a new standalone check script (`scripts/check-orphaned-tests.mjs`) to be built and wired up in CI workflows.

## Done when these pass

- [ ] **check-orphaned-tests.mjs passes because all test files are matched by a configured runner** — validates that the new CI check passes only when no orphaned tests exist
  `scripts/check-orphaned-tests.acceptance.test.mjs`
- [ ] **the check is wired up in github workflows** — ensures the CI check is actively run in PR checks so it doesn't rot
  `scripts/check-orphaned-tests.acceptance.test.mjs`

## Facets

- [ ] Create `scripts/check-orphaned-tests.mjs` that finds all `*.test.*` and `*.spec.*` files
- [ ] Make the script parse configured globs from `pr-checks.yml`, `migrations.yml`, and `vitest.workspace.ts`
- [ ] Make the script fail if any found test file does not match a configured runner
- [ ] Update configurations (like `vitest.workspace.ts`) to cover the 3 currently orphaned tests so the check goes green
- [ ] Add the new script to `.github/workflows/pr-checks.yml`

## Out of scope

- Fixing tests that are currently failing due to rotting code (only wiring them up is in scope)
- Refactoring the entire CI workflow structure
