# Definition of Done

> The explicitly requested recomputeSpecFile delegator/export is absent; existing callers use the generalized function.

**Strategy: `direct`** — The module `recompute-spec-file.ts` is the seam where the delegator export must be provided.

## Done when these pass

- [ ] **recomputeSpecFile delegator** — delegates to recomputeFile.
  `libs/shared/src/outbound/spec-trace/recompute-spec-file.acceptance.test.ts`

## Facets

- [ ] Export `recomputeSpecFile` from `libs/shared/src/outbound/spec-trace/recompute-spec-file.ts` as an alias to `recomputeFile`.

## Out of scope

- Extracting the document-agnostic blocks writer (already done, noted in ticket).
- Modifying callers to use `recomputeSpecFile` (existing callers are already using `recomputeFile`).
