---
adr_number: 18
title: "TDD adoption + per-subproject test CI"
status: accepted
date: 2026-05-29
domains: [testing, ci, dx]
---

# ADR-018: TDD adoption + per-subproject test CI

## Context

Lore has 44 test files across `shared`, `mcp-server`, `agent`, and `web-ui`,
and vitest is already the de-facto runner in all four. Despite that, the testing
approach was never decided or written down, and two concrete gaps surfaced:

1. **No methodology.** Code is written test-after or untested. The
   `improve-web-ui` branch shipped a PR-status classifier, README markdown
   helpers, and spec-path validation with no tests — none of it gated.
2. **No unit-test gate.** Only `test-integration.yml` exists (Postgres-backed,
   `mcp-server` only). Nothing runs the unit suites on a PR, so unit regressions
   reach `main` unnoticed.

A secondary defect: running the suites after a local build produced five
spurious failures. vitest discovered the stale compiled `dist/__tests__/*.js`
copies of the agent tests, which resolve a bundled `dist/workflows` directory
that only exists inside the Docker image — so they failed off a clean source
tree even though the `src` suite was green.

## Decision

1. **Adopt TDD (Red-Green-Refactor) for new code**, per the `tdd-start` skill:
   the Three Laws, one test at a time, commit-on-green, triangulation, and tests
   that describe behaviour rather than implementation. Characterization
   (test-after) is permitted only when adding tests to pre-existing code.
2. **vitest is the standard runner** across every subproject (`globals: true`,
   node environment).
3. **Per-subproject CI matrix** — `.github/workflows/test.yml` runs one job per
   subproject with `fail-fast: false`, so a failure names exactly which suite
   broke and one red suite never masks another. `mcp-server` and `agent` build
   `@re-cinq/lore-shared` first (they import its compiled output); `web-ui` is
   installed in place because it is not an npm workspace.
4. **Integration tests stay isolated** behind `vitest.integration.config.ts` and
   the Postgres-backed `test-integration.yml`; they are excluded from the
   default `vitest run` and from the unit matrix.
5. **Exclude `dist/**` from vitest discovery** in `agent` and `mcp-server` to
   kill the stale-compiled-copy failures.

The concrete conventions (naming, assertions, placement, what-to-test) live in
`specs/testing-standards/`.

### Alternatives considered

- **No enforced methodology (status quo).** Rejected — it is precisely what
  produced the untested `improve-web-ui` branch.
- **One combined `vitest run` at the repo root.** Rejected — it hides which
  subproject failed, couples web-ui's separate (non-workspace) install to the
  root workspace install, and would drag the Postgres requirement onto otherwise
  pure-unit runs.
- **Switch to jest.** Rejected — vitest is already in place everywhere; no payoff.

## Consequences

**Positive:**
- Regression safety net on every PR, attributable to a single subproject.
- Parallel, independent runs give fast feedback.
- TDD keeps new code testable by construction (pure functions, thin IO).
- The `dist/**` exclude makes local `build`-then-`test` reliable.

**Negative:**
- TDD is a workflow change with a learning curve; reviewers must check that
  tests accompany new behaviour.
- Node setup is duplicated across matrix entries (acceptable for isolation).
- web-ui's non-workspace status requires `--prefix web-ui` special-casing in CI.

See `specs/testing-standards/` for the detailed conventions this decision adopts.
