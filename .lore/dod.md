# Definition of Done

> A cross-repository query returns the eligible plans across the caller’s authorized repositories.

**Strategy: `direct`** — The acceptance test calls the new cross-repo query directly. The test cannot connect to Postgres in this pod; the red bar is CI's to show in the `Integration Tests` job.

## Done when these pass

- [ ] **plan-store-pg cross-repository retrieval > returns eligible plans across the given authorized repositories** — The query returns plans from multiple repositories.
  `apps/lore-api/src/outbound/plans/plan-store-pg.acceptance.test.ts`

## Facets

- [x] Implement `listCrossRepoPlanMetas` in `plan-store-pg.ts`
- [x] Ensure existing single-repository plan persistence/listing remains reusable

## Out of scope

- Wiring the query into the `/api/inbox` route (handled by the rest of T002 or inbox implementation)
