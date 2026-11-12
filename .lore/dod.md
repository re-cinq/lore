# Definition of Done

> The new migration drops all three tables across affected schemas and a second execution succeeds.

**Strategy: `direct`** — The migration file already exists, so we directly test it by providing a database schema that contains the targeted legacy v2 tables across multiple schemas, running the migration SQL against it, and verifying its idempotent execution and the absence of the tables. The red bar is CI's to show; this pod cannot run the PostgreSQL integration tests, which are run in CI by the `test` job.

## Done when these pass

- [ ] **drops all three tables across affected schemas and a second execution succeeds** — creates a test database with legacy tables in multiple schemas, runs migration 0008 twice, and validates the tables are gone while others remain untouched.
  `apps/lore-api/src/integration-tests/drop-v2-spec-coverage-tables.acceptance.test.ts`

## Facets

- [x] Write integration test to run `0008_drop_v2_spec_coverage_tables.sql` twice against a Postgres test schema.

## Out of scope

- Testing migrations other than 0008.
- Changes to the migration source itself, since it already achieves the right outcome (the missing piece is the database execution test).
