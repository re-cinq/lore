# Definition of Done

> Log the resolved template used after unknown-name fallback, and cover that condition through the registered tool; keep durable persistence as the spec's separate follow-up.

**Strategy: `direct`** — The `lore_assemble_context` tool is the existing entry point, so we can test it directly by stubbing the API response to simulate the fallback condition. The red bar is CI's to show; the CI job that runs the tests is `vitest`.

## Done when these pass

- [x] **Logs the resolved template used after unknown-name fallback** — Assert that the audit log outputs the resolved template string rather than the invalid requested name.
  `apps/mcp-server/src/transport/tools/context/assemble-context-fallback.acceptance.test.ts`

## Facets

- [ ] Add the resolved template to the API response.
- [x] Read the resolved template from the proxy response in the MCP tool.
- [x] Pass the resolved template to the logging function.

## Out of scope

- Durable persistence of audit logs (tracked as a separate follow-up).
- Validating the actual fallback logic inside the API (the test focuses on the tool's logging).
