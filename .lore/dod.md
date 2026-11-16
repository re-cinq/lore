# Definition of Done

> - `libs/server-core/src/work/spec-trace/query-trace.ts:16-23`: with a statement selector, a document that has no graph data answers "No statement matches" and never reaches the no-graph-data branch at `:29`. Check for the empty document first.
> - `apps/lore-api/src/transport/routes/trace/trace.ts:150-156` drops `depth` ("One hop: `depth` is not walked yet") while the tool schema in `apps/mcp-server/src/transport/tools/spec-trace/query-trace.ts:55-59` advertises it. Refuse `depth` above 1 with a 400 and say in the tool description that one hop is what it answers.
> - `libs/server-core/src/work/spec-trace/query-trace.ts:215-229`: `callGraphQuery` returns the raw API JSON. Format callers and callees as readable lines, with a plain answer when there are none.

**Strategy: `direct`** — The seam already exists for both the route handlers and the `formatTraceQuery`/`runQueryTrace` functions, allowing acceptance tests directly against the current endpoints and formatters.

## Done when these pass

- [ ] **query-trace empty doc with selector** — A selector query on a document with no graph data answers with a no-graph-data message.
  `libs/server-core/src/work/spec-trace/query-trace.acceptance.test.ts`
- [ ] **query-trace callers formatter** — A callers query returns one line per caller with file and symbol, and 'no callers found' when empty.
  `libs/server-core/src/work/spec-trace/query-trace.acceptance.test.ts`
- [ ] **trace-callers depth** — depth > 1 is refused with a 400 saying one hop is supported.
  `apps/lore-api/src/transport/routes/trace/trace-callers.acceptance.test.ts`

## Facets

- [ ] Check for `doc.statements.length === 0` in `formatTraceQuery` before selector evaluation.
- [ ] Read and refuse `depth > 1` in `callersResult` API handler.
- [ ] Format `callGraphQuery` response as a list of lines with file and symbol.
- [ ] Update `query-trace.ts` tool schema description to indicate only depth 1 is supported.

## Out of scope

- Walking depth > 1 (waiting for future work).
- Formatting of other tool outputs beyond callers/callees.