# Definition of Done

> Create infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0094_skill_definitions.sql (next slot) defining the lore.skill_definitions table with columns: name, title, description, model, content, enabled, project_id.

**Strategy: `direct`** — The integration test asserts against the Postgres schema structure the migration applies, using the generic DB test pattern of the API suite.

## Done when these pass

- [ ] **creates lore.skill_definitions with the correct columns** — asserts the table structure in the DB matches the columns specified in FR-001. CI provides the test database that runs this against the migration output.
  `apps/lore-api/src/integration-tests/skill-definitions-migration.acceptance.test.ts`

## Facets

- [x] Write `0112_skill_definitions.sql` (using the actual next free slot instead of the taken `0094`) to create `lore.skill_definitions`.

## Out of scope

- Application logic to use the `skill_definitions` table is not required to consider the migration complete.
