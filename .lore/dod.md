  # Definition of Done

  > Demote to partial: nodeMatchesQuery searches one concatenated label-plus-path string, while the contract requires a substring of either field and false when neither contains the query. For {label:"alpha", path:"beta"} and query "alpha beta", it returns true even though neither field contains that query.

  **Strategy: `direct`** — A seam already exists. The acceptance test can call `nodeMatchesQuery` directly and fail on behaviour.

  ## Done when these pass

  - [ ] **returns false when neither field contains the query, even if their concatenation does** — returning false when neither field individually contains the query, despite cross-field overlap
    `apps/web-ui/src/lib/graph-search.acceptance.test.ts`

  ## Facets

  - [ ] Add cross-field regression test to `apps/web-ui/src/lib/graph-search.acceptance.test.ts`
  - [ ] Update `nodeMatchesQuery` to check `label` and `path` separately.

  ## Out of scope

  - Changes to other matching logic (e.g. empty queries) that are already working.