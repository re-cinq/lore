# Definition of Done

> Vector leg survives sparse types filtering.

**Strategy: `direct`** — A seam exists in `assembleContext` where we can query and verify the behavior. Since this requires Postgres to test HNSW index scan behavior, the red bar is CI's to show and the CI job `Integration tests` runs the tests.

## Done when these pass

- [ ] **Vector leg survives sparse types filtering** — Verifies that `assembleContext` returns the sparse ADRs instead of being filtered out by HNSW ef_search limit.
  `libs/shared/src/outbound/project/knowledge/context-assembly-sparse.acceptance.test.ts`

## Facets

- [ ] Write acceptance test using `assembleContext` to query ADRs and verify `vectorLegRows` in the debug trace.

## Out of scope

- Other context assembly formatting tasks, such as task type filtering.