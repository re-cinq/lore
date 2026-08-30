# Definition of Done

Strategy: direct
Why: Real seams exist — vitest.config.ts files on disk and .github/workflows/pr-checks.yml are both readable with no I/O beyond the filesystem. The test calls the real entry points (file reads) and fails on the absent behaviour (three packages not in the CI matrix).

Acceptance tests:
  - scripts/check-ci-coverage.test.mjs::"every package with a vitest.config.ts has a CI job in pr-checks.yml" — asserts that every package declaring a vitest.config.ts also appears in the pr-checks.yml test matrix; fails right now because apps/cluster-agent, apps/event-router, and apps/vscode-extension are omitted.

Facets (the red-green-refactor steps you expect, smallest first):
  - Add a CI matrix entry for apps/cluster-agent (@re-cinq/lore-cluster-agent) to pr-checks.yml
  - Add a CI matrix entry for apps/event-router (@re-cinq/lore-event-router) to pr-checks.yml
  - Add a CI matrix entry for apps/vscode-extension (lore-vscode) to pr-checks.yml

Out of scope: Adding tests to any of the three uncovered packages; changing vitest configs; changing what counts as "a test suite" (only vitest.config.ts is the signal); covering non-vitest test runners (node --test scripts are covered by the scripts matrix entry which already exists).
