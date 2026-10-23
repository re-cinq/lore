# Definition of Done

> Sections are formatted and empty sections are omitted.

**Strategy: `direct`** — The `serializeContext` function is the direct entry point for serializing the assembled sections.

## Done when these pass

- [ ] **omits empty sections from output** — `serializeContext` drops a section entirely when it has no documents.
  `libs/shared/src/outbound/project/knowledge/context-assembly-format.acceptance.test.ts`

## Facets

- [x] `serializeContext` skips formatting a `<section>` if its `documents` array is empty.

## Out of scope

- Truncation logic (handled in budget allocation).
- Data retrieval.
