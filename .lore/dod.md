# Definition of Done

> Generic or missing link labels yield the actual test name via AST/language fallback, with deterministic graph identity.

**Strategy: `direct`** — The entry point `projectSpecFile` writes link targets via `projectTestLinks`. The acceptance test calls the real entry point today, but the CI's live-Dgraph integration suite is required to run it since this pod cannot reach Dgraph.

## Done when these pass

- [ ] **yields the actual test name via fallback when the label is generic** — Dgraph assertions verify the fallback logic works when link label is generic.
  `libs/shared/src/work/spec-trace/project-spec-file.acceptance.test.ts`

## Facets

- [x] Add the AST/language test-name fallback to `projectTestLinks`

## Out of scope

- Re-projecting all existing TestChunks retroactively.
