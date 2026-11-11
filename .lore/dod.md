# Definition of Done

> We need to persistently store per-user handled and snoozed states for inbox items.

**Strategy: `direct`** — The acceptance tests directly verify the existence and structure of the required `lore.inbox_item_state` database table via integration tests and the presence of the required `inbox-item-state` domain model. The red bar for the database integration test is CI's to show; it is run by the `integration` job in `.github/workflows/test-integration.yml`.

## Done when these pass

- [ ] **Creates lore.inbox_item_state with the correct columns** — Verifies the table is created by the migration with correct structure.
  `apps/lore-api/src/integration-tests/inbox-item-state-migration.acceptance.test.ts`
- [ ] **Exports a Zod schema and column map for inbox item state** — Verifies the new domain model is correctly implemented.
  `libs/shared/src/domain/models/inbox-item-state.acceptance.test.ts`

## Facets

- [ ] Add the `0111_inbox_item_state.sql` migration to create the table structure.
- [ ] Add the domain model implementation in `libs/shared/src/domain/models/inbox-item-state.ts`.

## Out of scope

- Implementing the routes or logic to query the table.
