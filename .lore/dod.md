# Definition of Done

> Create default.yaml defining all sources with balanced priorities. Target file: `apps/mcp-server/templates/default.yaml`

**Strategy: `direct`** — The seam exists via the context assembly's template loader, allowing us to load the templates directory and verify the default template's contents.

## Done when these pass

- [ ] **includes sections for repo, adrs, memories, facts, and graph.** — The `default.yaml` template must exist on disk and correctly parse into a template with the required sections defined.
  `apps/mcp-server/src/template-default.acceptance.test.ts`

## Facets

- [ ] Create `apps/mcp-server/templates` directory.
- [ ] Add `default.yaml` to the directory with sections for `repo`, `adrs`, `memories`, `facts`, and `graph`.
- [ ] Assign sensible priorities across the sections.

## Out of scope

- Testing the template loading logic itself, which is covered elsewhere.
- Using or rendering the context from the default template in an actual MCP server request.