# Definition of Done

> Register the MCP tool schema and map its execution to the new assembly functions. Include basic audit logging logic.

**Strategy: `direct`** — The MCP tool handler `lore_assemble_context` is exposed directly in the test helper and can be invoked with a stubbed `fetch`.

## Done when these pass

- [ ] **Logging captures call variables: query, template used, sources hit, total tokens returned** — The tool logs the required variables by parsing the trace returned from the API.
  `apps/mcp-server/src/transport/tools/context-tools-assemble.acceptance.test.ts`

## Facets

- [ ] Log the audit string into `console.error` after executing the proxy request.

## Out of scope

- Persisting the audit log to database.
