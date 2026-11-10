# Definition of Done

> The task asks for all four reads concurrently, and no concurrency regression establishes/reconciles that stronger contract.

**Strategy: `direct`** — The global `fetch` is stubbed to inject network delays, observing the exact request order and concurrency of `fetchPrStatus` without modifying the module's real boundaries.

## Done when these pass

- [x] **starts fetching check-runs as soon as PR resolves, without waiting for reviews or threads** — ensures the request for `check-runs` relies solely on the PR's `headSha` and proceeds independently of the slower `reviews` or `graphql` reads.
  `apps/lore-api/src/outbound/github-client.acceptance.test.ts`

## Facets

- [x] refactor `fetchPrStatus` to initiate the `pr` fetch independently and `.then()` or `await` it inside a separate promise chain to fetch `check-runs` while `reviews` and `threads` are still pending

## Out of scope

- Updating existing unit tests for failure fallbacks (already verified)
