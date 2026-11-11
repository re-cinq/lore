# Definition of Done

> The named tests only regex-read SQL, never execute it twice against empty/partial schemas. The migration can explicitly skip all memory changes on insufficient privilege, so successful deploy is not proof of convergence.

**Strategy: `direct`** — The `0013` and `0014` migrations can be executed directly against PostgreSQL databases mimicking empty and legacy-bootstrapped states to prove convergence. Note: CI runs the tests because this pod has no PostgreSQL. The CI job is `test` or similar.

## Done when these pass

- [x] **applies migration sequence twice on a legacy (partially migrated) database and leaves the required schema** — Verifies `0013` and `0014` idempotency, convergence, and ownership guards on a legacy DB.
  `apps/lore-api/src/integration-tests/hippo-migrations.acceptance.test.ts`
- [x] **applies migration sequence twice on an empty database and leaves the required schema** — Verifies the migrations complete successfully without throwing on a fresh database.
  `apps/lore-api/src/integration-tests/hippo-migrations.acceptance.test.ts`

## Facets

- [x] Delete regex tests from `migrations.test.ts`.
- [x] Implement database integration tests simulating empty and legacy schemas.
- [x] Update `specs/platform-infrastructure/spec.md` with new test linkages.
- [x] Fix CI auth: use LORE_DB_USER/LORE_DB_PASSWORD env vars for app-user pools; introduce dedicated non-superuser migrator role for privilege-guarded scenario.

## Out of scope

- Backfilling production or modifying migration scripts.
