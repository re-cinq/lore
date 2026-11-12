# Definition of Done

> Block pruning on re-projection: re-projecting shorter content prunes orphaned `Block` nodes so `recompute` tracks the current source. Unified to `pruneOrphanBlocksByFile` (file_path-scoped) across spec + ADR.

**Strategy: `direct`** — The ticket requests tests for the existing block pruning on re-projection logic. Tests are added directly calling `projectSpecFile` and `projectAdrFile` with shorter content and verifying `recomputeFile` output. The red bar is CI's to show (Integration Tests job) because tests require a live Dgraph database which is not available in this pod.

## Done when these pass

- [ ] **recomputes the shorter source when re-projecting fewer blocks prunes the orphaned Blocks** — re-projecting a shorter spec prunes orphaned blocks
  `libs/shared/src/work/spec-trace/block-pruning.acceptance.test.ts`
- [ ] **recomputes the shorter source after re-projecting a SHORTER ADR over a longer one** — re-projecting a shorter ADR prunes orphaned blocks
  `libs/shared/src/work/spec-trace/block-pruning.acceptance.test.ts`

## Facets

- [ ] Write acceptance tests for pruning in specs and ADRs
- [ ] Ensure they are properly linked in spec.md

## Out of scope

- Production code changes are out of scope (implementation already exists).
