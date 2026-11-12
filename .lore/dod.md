# Definition of Done

> The requested recomputeSpecFile entry point is not exported or implemented; this is a naming/API requirement needing reconciliation, not missing reconstruction logic.
> Explicitly accept the generalized API as the replacement or add the requested spec reconstruction delegate.

**Strategy: `direct`** — A seam exists. `recomputeFile` is already implemented and `recomputeSpecFile` is requested as a delegate alias. The acceptance test asserts this entry point is exported and maps to the generalized API.

## Done when these pass

- [x] **is exported as a thin alias for recomputeFile** — validates that `recomputeSpecFile` is defined and strictly equals `recomputeFile`
  `libs/shared/src/outbound/spec-trace/recompute-spec-file.acceptance.test.ts`

## Facets

- [x] Export `recomputeSpecFile` as an alias of `recomputeFile` in `libs/shared/src/outbound/spec-trace/recompute-spec-file.ts`

## Out of scope

- Modifications to the core graph reconstruction logic in `recomputeFile` or `reassembleBlocks`
