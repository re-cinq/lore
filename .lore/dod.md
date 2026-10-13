# Definition of Done

> Two hybrid-search implementations have diverged: the corpus search still has the defects #1924 fixed
> 
> Three divergences explain it:
> 1. Full-sentence tsquery.
> 2. No normalisation.
> 3. No repo binding. The hits come from other repos' content in org_shared. hybridChunkItems binds the repo (FR-2.14).

**Strategy: `direct`** — The seam already exists via the exported `hybridSearch` module and its test suite. The red bar is CI's to show because local execution fails on a workspace import resolution error; the CI build job proves the red bar.

## Done when these pass

- [ ] **keyword leg uses websearch_to_tsquery with extracted key terms, not plainto_tsquery over the whole question** — A query should be reduced to distinct terms to avoid returning zero hits for a full-sentence AND condition.
  `libs/server-core/src/outbound/db-hybrid-defects.test.ts`
- [ ] **normalises rrf_score so the highest-ranked result is 1.0 (not a raw 1/61 value)** — RRF scores need normalization for legibility and to spread properly.
  `libs/server-core/src/outbound/db-hybrid-defects.test.ts`
- [ ] **binds the search to a specific repo so results from other repos are excluded (FR-2.14)** — Results must be scoped to the targeted repository rather than polluting from the entire org_shared schema.
  `libs/server-core/src/outbound/db-hybrid-defects.test.ts`

## Facets

- [ ] Extract shared search core or port `hybridChunkItems` behaviour to `hybridSearch`.
- [ ] Ensure key term extraction applies before `websearch_to_tsquery`.
- [ ] Add score normalisation.
- [ ] Enforce repo filtering on query schema when searching org_shared.

## Out of scope

- Removing `plainto_tsquery` from non-hybrid contexts if used elsewhere.