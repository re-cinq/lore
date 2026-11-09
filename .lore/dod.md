# Definition of Done

> Bound /trace/graph: the web UI coverage view still reads ~600 MB
> 
> The trace/graph route (GRAPH_DQL in libs/shared/src/outbound/spec-trace/spec-graph.ts) has no bound. It repeats every test's coverage once per statement that test validates, then again in a second tests block. For re-cinq/lore the answer is about 600 MB. lore-api went from 229 MB to 845 MB within 10 s of one request, and was OOM-killed twice on 2026-11-05.

**Strategy: `direct`** — The trace route and graph flattening logic already exist and can be tested directly.

## Done when these pass

- [x] **returns 400 to refuse an unbounded read of a whole repository** — `/trace/graph` route refuses unbounded reads with a 400 Bad Request
  `apps/lore-api/src/transport/routes/trace/trace-graph.acceptance.test.ts`
- [x] **draws covers links when coverage is only listed once in the tests block, leaving it out of the per-statement block** — `flattenSpecGraph` emits `covers` links without expecting coverage inside each statement's `validated_by` links
  `libs/shared/src/outbound/spec-trace/spec-graph.acceptance.test.ts`

## Facets

- [x] Enforce bounds on the `/trace/graph` route by requiring a path parameter
- [x] Update `flattenSpecGraph` to lookup the coverage from the `tests` block instead of `stmts[].vb[].cov`
- [x] Modify `GRAPH_DQL` to leave each test's coverage out of the per-statement block and list it once

## Out of scope

- Moving the Web UI coverage view to per-file reads
