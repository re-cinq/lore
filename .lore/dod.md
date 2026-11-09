# Definition of Done

> Implementation is present, but the required behavioral proof is incomplete: @re-cinq/lore-shared/src/domain/test-paths.test.ts: matches the same 13 test paths and 11 production paths in Postgres through TEST_PATH_SQL_PATTERN (not-passed)

**Strategy: `direct`** — The acceptance test directly connects to Postgres via pg.Pool and evaluates the TEST_PATH_SQL_PATTERN against the paths, asserting the exact behavior of the regex. The pod cannot run this against Postgres, so the red bar is CI's to show; the `integration` job (in `test-integration.yml`) runs the live Postgres suite.

## Done when these pass

- [ ] **matches the same 13 test paths and 11 production paths in Postgres through TEST_PATH_SQL_PATTERN** — Postgres accepts exactly the paths isTestFile does
  `libs/shared/src/domain/test-paths.acceptance.test.ts`

## Facets

- [ ] Fix Postgres compatibility in TEST_PATH_SQL_PATTERN regex

## Out of scope

- Testing or supporting other test path conventions
