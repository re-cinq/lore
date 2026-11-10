# Definition of Done

> Propagate the selected repo into memory/fact retrieval or explicitly filter their results, and verify a selected repo cannot show another repo's memory/fact hits.

**Strategy: `direct`** — The `SearchPage` uses `apiFetch` which makes a network request. The acceptance test spins up a local HTTP server and binds `LORE_API_URL` to it, intercepting the fetch to verify that `repo` is correctly propagated as a query parameter.

## Done when these pass

- [ ] **propagates the selected repo into memory/fact retrieval** — The test observes `SearchPage` propagation of the repo query param into the `apiFetch` call targeting `/api/memory-search`.
  `apps/web-ui/src/app/search/search-memory-repo-propagation.acceptance.test.tsx`

## Facets

- [ ] Pass `repo` parameter from `runSearch` down to `searchMemory`.

## Out of scope

- Updating any UI styling or layout.
- The ticket explicitly filtering has already been accomplished by a prior PR, so this DoD focuses entirely on propagation.
