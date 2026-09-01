Three packages — `apps/cluster-agent`, `apps/event-router`, and `apps/vscode-extension` — each had a `vitest.config.ts` and a populated test suite that no CI job ran. A regression in any of them would sail through PR review undetected, because nothing asked the question.

This PR closes that gap in two commits that follow the same red-green-refactor shape the DoD required: a failing guard first, then the CI additions that make it pass.

**The guard** (`scripts/check-ci-coverage.test.mjs`) scans `apps/` and `libs/` for directories that have both a `vitest.config.ts` and a `package.json`, then checks `.github/workflows/pr-checks.yml` for either the `relDir` string or the package name. Any directory that has a test config but no CI entry is reported in the assertion failure message, so a future developer who adds a new subproject without wiring a CI job sees an actionable failure rather than silent green. The test runs as part of the existing `scripts` matrix entry (`find scripts -name '*.test.mjs' -print0 | xargs -0 node --test`), so it gates every PR at no extra workflow cost.

The guard is linked from `specs/testing-standards/spec.md` requirement 3 ("Attributable CI") at `specs/testing-standards/spec.md:36`. The link target is `scripts/check-ci-coverage.test.mjs#L38`, which is correct after this branch.

**The CI additions** add three entries to the `pr-checks.yml` matrix, each with a `build: npm run build -w @re-cinq/lore-shared` pre-step (the three packages import from the compiled shared library) and the workspace-scoped `npm test` command. The entries sit next to the `lint` job at line 215, keeping the matrix in alphabetical order.

The DoD strategy was "direct" — the real files on disk are the seams, and the test calls the real entry points with no mocks. No deviation from that strategy.

Acceptance test: `scripts/check-ci-coverage.test.mjs::"every package with a vitest.config.ts has a CI job in pr-checks.yml"` — was red before the CI additions, green after.
