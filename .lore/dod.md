# Definition of Done

> Propagate the selected repo into memory/fact retrieval or explicitly filter their results, and verify a selected repo cannot show another repo's memory/fact hits.

**Strategy: `parallel-change`** — No seam exists in the Next.js server component `page.tsx` to test filtering logic without hitting the untestable `apiFetch` (which fails without `LORE_API_URL`). We extract the filtering logic into a new pure module `filter-memories.ts` and point the acceptance tests at it. The caller will be switched over once it is green.

## Done when these pass

- [ ] **verifies a selected repo cannot show another repo's memory/fact hits** — filters out hits that have a different repo than the selected one, while keeping hits that belong to the selected repo or are organization-wide (null repo).
  `apps/web-ui/src/app/search/filter-memories.acceptance.test.ts`

## Facets

- [x] Implement `filterCrossRepoMemories` to drop hits where `repo` does not match `selectedRepo`.
- [ ] Wire up `filterCrossRepoMemories` in `runSearch` within `apps/web-ui/src/app/search/page.tsx`.
- [ ] Fix the backend `memory-search-routes.ts` to return actual `repo` instead of `NULL as repo` so the filter can see it.

## Out of scope

- Embedding search (`lore_search_memory`) is out of scope as it already handles `repo` via `searchAction`.