# Definition of Done

> Create the directory apps/mcp-server/templates/.keep.

**Strategy: `mechanical`** — The ticket is a fully-specified edit that creates an empty directory to satisfy a directory structure requirement, which owes no new behaviour test. The red bar is CI's to show; CI jobs `server-core` and `mcp-server` run the tests.

## Done when these pass

- [ ] **FR-3.1 template loading** — the existing test ensuring templates are loaded stays green
  `libs/server-core/src/work/context/context-assembly.test.ts`

## Facets

- [ ] Create `apps/mcp-server/templates/.keep`

## Out of scope

- Creating actual YAML templates.
