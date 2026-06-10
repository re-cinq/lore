# Feature Specification: `query_trace` MCP Tool

| Field          | Value                                                                                     |
|----------------|-------------------------------------------------------------------------------------------|
| Feature        | `query_trace` MCP Tool                                                                     |
| Status         | **Draft**                                                                                  |
| Created        | 2026-06-10                                                                                 |
| Owner          | Platform Engineering                                                                       |
| Consumes       | [`spec-traceability-graph`](../spec-traceability-graph/spec.md) — the `/trace/document` read route |
| Sibling        | [`graph-context-assembly`](../graph-context-assembly/spec.md) — shares the `violated > drifted > untested` signal ordering |

## Problem Statement

The `query_trace` MCP tool was registered as a stub that ignores its input
and returns *"Trace queries are not yet available."* — left that way until the
Dgraph projection shipped. The projection has shipped: the graph holds each
spec `Statement` with its `validated_by`/`implemented_by`/`decided_by` links
and its `drifted`/`violated` flags, and the backend serves them at
`GET /api/repos/:owner/:repo/trace/document`. The tool just isn't wired to it,
so a developer in a Claude session cannot ask "what validates this statement,
and is it currently broken."

The developer-facing MCP runs locally in stdio mode and has **no Dgraph
client**, so the tool cannot read the graph directly — it must reach the
main-branch graph through the remote API.

## Solution

Wire `query_trace` to proxy a read to the remote `/trace/document` route and
project the returned `TraceDocument` into agent-readable text. The orchestrator
resolves the repo, issues one GET via the proxy, and formats the result
([`runQueryTrace`](../../mcp-server/src/features/spec-trace/query-trace.ts#L100));
the projection itself is a pure function
([`formatTraceQuery`](../../mcp-server/src/features/spec-trace/query-trace.ts#L76));
the GET proxy reuses the shared retry/config machinery
([`proxyGetApi`](../../mcp-server/src/mcp/tools/deps.ts#L104)); the tool is
registered read-only on the shared surface
([`query_trace` registration](../../mcp-server/src/mcp/tools/spec-trace-tools.ts#L40)).

## Acceptance Criteria

With no `statement` selector, the result lists the document coverage and then
only the `violated`, `drifted`, and `untested` statements, in that order.
([validated by `with no selector, lists coverage then violated, drifted, untested statements in that order`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L19))

An ordinal selector returns that statement in full with its test, code, and ADR
links grouped, and flags it when violated.
([validated by `with an ordinal selector, returns that statement with its test, code, and adr links grouped`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L41))

A case-insensitive text-substring selector returns every matching statement.
([validated by `with a case-insensitive substring selector, returns every matching statement`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L71))

An empty `TraceDocument` yields a no-graph-data message rather than an error.
([validated by `with an empty document, returns a no-graph-data message rather than throwing`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L88))

The tool proxies a GET to the repo's `trace/document` route and formats the
returned document.
([validated by `proxies a GET to the repo's trace/document route and formats the result`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L100))

The tool resolves the repo from `detectCurrentRepo` when `repo` is omitted, and
reports clearly when none can be detected.
([validated by `resolves the repo from detectRepo when repo is omitted, and reports when none is found`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L111))

With `LORE_API_URL` or the token unset, the tool returns a not-configured text
response rather than throwing.
([validated by `returns a not-configured message when no proxy is configured`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L119))

A `403 insufficient scope` from the remote surfaces a read-scope hint.
([validated by `surfaces a read-scope hint when the remote returns 403 insufficient scope`](../../mcp-server/src/features/spec-trace/query-trace.test.ts#L127))

## Out of Scope

- The test-rooted direction ("what does test Y cover") — the `/trace/document`
  route is spec-rooted; that needs a separate read endpoint.
- Any new backend route — this consumes the existing read route unchanged.
- Free-form natural-language query parsing — the input is structured
  (`spec` + optional `statement`), deterministic, no LLM.
