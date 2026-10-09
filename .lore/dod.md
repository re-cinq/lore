# Definition of Done

> 1. **The status is wrong.** "I could not reach the database" is 503, not 403. As it stands a real outage is indistinguishable from a revoked token, both to CI and to anyone reading the logs.
> 2. **It hides infra trouble.** The `catch` discards the error entirely, so nothing is logged about why the lookup failed.

**Strategy: `direct`** — The auth strategy and scope resolver have existing test suites where we can assert the failure modes and returned status codes.

## Done when these pass

- [x] **throws when the DB lookup throws** — ensures `resolveTokenScopes` surfaces the DB error instead of suppressing it as null
  `apps/lore-api/src/transport/http/auth.test.ts`
- [x] **returns 503 when the token lookup query throws** — ensures the bearer-scope auth strategy returns a 503 error when a DB connection drops during token validation
  `apps/lore-api/src/transport/http/bearer-scope.test.ts`

## Facets

- [x] Remove the empty `catch` returning `null` in `lookupTokenScopes`
- [x] Catch the DB error in `authenticateBearer` and map it to a 503 Boom error
- [x] Add logging for the DB error in `authenticateBearer` or `lookupTokenScopes`
- [x] Fix mock pool returning undefined to correctly return 0 rows, so missing tokens yield 403 instead of 503

## Out of scope

- Updating the retry logic in the caller (CI workflow already treats 503 as transient)