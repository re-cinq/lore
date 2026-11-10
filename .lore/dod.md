# Definition of Done

> Normalize the PostgreSQL PR number to the declared numeric wire type (or explicitly change the contract) and validate both endpoints against a real BIGINT row.

**Strategy: `direct`** — The API routes already exist; we are simulating the PostgreSQL driver's BIGINT return type in tests to ensure we cast strings back to numbers as defined by the route's numeric schema.
The red bar is CI's to show. The tests are run by the `lore-api (1/2)` or `lore-api (2/2)` jobs in the PR Checks workflow.

## Done when these pass

- [ ] **normalizes a BIGINT string pr_number to a number for the specific PR route** — validates that `mapRow` explicitly parses `BIGINT` string PR numbers to numbers for the `/pulls/{number}/blocked-reason` endpoint.
  `apps/lore-api/src/transport/routes/blocked-reasons.acceptance.test.ts`
- [ ] **normalizes a BIGINT string pr_number to a number for the blocked-pulls list route** — validates that `mapRow` explicitly parses `BIGINT` string PR numbers to numbers for the `/blocked-pulls` endpoint.
  `apps/lore-api/src/transport/routes/blocked-reasons.acceptance.test.ts`

## Facets

- [ ] Explicitly cast or parse `row.pr_number` inside `mapRow` function inside `blocked-reasons.ts`.

## Out of scope

- Updating schemas to support string PR numbers (we stick with numeric wire types).
- Changing DB column types.
