# Feature Specification: `lore-query-trace` MCP Tool

| Field          | Value                                                                                     |
|----------------|-------------------------------------------------------------------------------------------|
| Feature        | `lore-query-trace` MCP Tool                                                                     |
| Status         | In Progress                                                                                  |
| Created        | 2026-06-10                                                                                 |
| Owner          | Platform Engineering                                                                       |
| Consumes       | [`spec-traceability-graph`](../spec-traceability-graph/spec.md) — the `/trace/document` read route |
| Sibling        | [`graph-context-assembly`](../graph-context-assembly/spec.md) — shares the `violated > drifted > untested` signal ordering |

The `lore-query-trace` MCP tool proxies a read to the remote `/trace/document` route and projects per-statement spec coverage into agent-readable text, letting a developer in a Claude session ask which tests validate a statement and whether any are currently drifted or violated.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/spec-trace-tools.ts#L40)).

- **name**: `lore-query-trace`
- **description** (verbatim):

```text
READ side of spec-traceability: returns per-statement coverage for a spec — which tests validate each statement and which are drifted or violated. Read-only; executes and builds nothing. The graph is (re)projected by CI — specs/adrs on push, tests via lore-tests.yml — not by an MCP tool. Instead: to enumerate or run tests locally use lore_list_tests / lore_run_test.
```

### Input schema

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `spec` | yes | — | Spec file path relative to the repo root, e.g. `specs/auth/spec.md`. |
| `statement` | no | — | 1-based ordinal (e.g. `'3'`) or unique text substring to narrow to a single statement. Omit for whole-spec summary. |
| `repo` | no | — | Target repo as `'owner/repo'`. Defaults to the repo detected from cwd git remote. |

## Problem Statement

The `lore-query-trace` MCP tool was registered as a stub that ignores its input
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

Wire `lore-query-trace` to proxy a read to the remote `/trace/document` route and
project the returned `TraceDocument` into agent-readable text. The orchestrator
resolves the repo, issues one GET via the proxy, and formats the result
([`runQueryTrace`](../../libs/server-core/src/work/spec-trace/query-trace.ts#L172));
the projection itself is a pure function
([`formatTraceQuery`](../../libs/server-core/src/work/spec-trace/query-trace.ts#L10));
the GET proxy reuses the shared retry/config machinery
([`proxyGetApi`](../../apps/mcp-server/src/transport/tools/deps.ts#L16)); the tool is
registered read-only on the shared surface
([`lore-query-trace` registration](apps/mcp-server/src/transport/tools/spec-trace-tools.ts#L40)).

## Acceptance Criteria

With no `statement` selector, the result lists the document coverage and then
only the `violated`, `drifted`, and `untested` statements, in that order.
([validated by `with no selector, lists coverage then violated, drifted, untested statements in that order`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L19))

An ordinal selector returns that statement in full with its test, code, and ADR
links grouped, and flags it when violated.
([validated by `with an ordinal selector, returns that statement with its test, code, and adr links grouped`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L70))

A case-insensitive text-substring selector returns every matching statement.
([validated by `with a case-insensitive substring selector, returns every matching statement`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L106))

An empty `TraceDocument` yields a no-graph-data message rather than an error;
with no selector and no violated/drifted/untested statements, it says so
instead; and a selector matching nothing returns a no-match message.
([validated by `with an empty document, returns a no-graph-data message rather than throwing`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L141), [validated by `with no selector and no violated, drifted, or untested statements, says so`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L148), [validated by `with a selector matching nothing, returns a no-match message`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L167))

The tool proxies a GET to the repo's `trace/document` route and formats the
returned document.
([validated by `proxies a GET to the repo's trace/document route and formats the result`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L210))

The tool resolves the repo from `detectCurrentRepo` when `repo` is omitted, and
reports clearly when none can be detected.
([validated by `resolves the repo from detectRepo when repo is omitted, and reports when none is found`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L230))

With `LORE_API_URL` or the token unset, the tool returns a not-configured text
response rather than throwing.
([validated by `returns a not-configured message when no proxy is configured`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L239))

A `403 insufficient scope` from the remote surfaces a read-scope hint; a
non-403 unreachable error omits it.
([validated by `surfaces a read-scope hint when the remote returns 403 insufficient scope`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L251), [validated by `omits the scope hint for a non-403 unreachable error`](libs/server-core/src/work/spec-trace/query-trace.test.ts#L268))

## The `tests_covering` shape

The tool's second question, added for the implementation loop (issue #1770):
which tests exercise a span. A `tdd-round` asks it before it edits a symbol, so
that when the suite goes red it can tell the test it just wrote from a
regression it just caused.

The read is served by `GET /api/repos/{owner}/{repo}/trace/tests-covering`,
which names the covered source file in `path`, optionally narrows to `ranges`,
and optionally names the assembly run whose branch overlay should answer.

A request naming no covered file is refused rather than answered for the whole
repo. ([validated by returns 400 when no path names the covered file](apps/lore-api/src/transport/routes/trace/trace-tests-covering.test.ts#L44))

The route returns the port's covering tests under a `tests` key. ([validated by returns the port's covering tests under a tests key](apps/lore-api/src/transport/routes/trace/trace-tests-covering.test.ts#L52))

It parses `ranges` and passes them with the assembly run id to the port, ([validated by passes parsed ranges and the assembly run id to the port](apps/lore-api/src/transport/routes/trace/trace-tests-covering.test.ts#L65))

It omits ranges entirely when the query names none, so an unnarrowed question stays unnarrowed. ([validated by omits ranges from the target when the query names none](apps/lore-api/src/transport/routes/trace/trace-tests-covering.test.ts#L82))

A `ranges` query past the length bound is refused. ([validated by returns 400 when the ranges query exceeds the length bound](apps/lore-api/src/transport/routes/trace/trace-tests-covering.test.ts#L90))

The repo-bound view binds its own repo and forwards the target and run id to the
port, ([validated by binds the view's repo and forwards target plus run id to the port](libs/shared/src/outbound/project/trace/trace.test.ts#L29))

It returns what the port answered unchanged when no run id narrows the read. ([validated by returns the port's covering tests unchanged when no run id narrows the read](libs/shared/src/outbound/project/trace/trace.test.ts#L46))

The tool renders one row per test file, marking the row that came from the
branch overlay and the statement each file validates. ([validated by renders one row per test file, marking the overlay row and the statement it validates](libs/server-core/src/work/spec-trace/query-trace.test.ts#L310))

An empty answer renders as a sentence saying so, never as empty output — an
agent cannot tell a blank reply from a broken one. ([validated by renders a no-tests-cover sentence for an empty list](libs/server-core/src/work/spec-trace/query-trace.test.ts#L332))

The run id and ranges reach the proxied URL url-encoded. ([validated by passes assembly_run_id and ranges through to the proxied url, url-encoded](libs/server-core/src/work/spec-trace/query-trace.test.ts#L341))

An unreachable API is reported as prose rather than thrown, like every other
shape this tool serves. ([validated by reports the proxy failure rather than throwing when the api is unreachable](libs/server-core/src/work/spec-trace/query-trace.test.ts#L366))

## The `failures_touching` shape

The tool's third question, added for the implementation loop (issue #1771):
what has failed on this file before. `fix-ci` asks it for every path in a red
build's output before it reads any file, because this repository has very likely
hit the same error before and the diff that ended it is the cheapest thing the
round can read.

The read is served by
`GET /api/repos/{owner}/{repo}/trace/failures-touching`, which names the
source file in `path`. It reaches the graph directly rather than through the
Project facade, because the failure reader lives in a tier the outbound ports
may not import.

A request naming no source file is refused. ([validated by returns 400 when no path names the source file](apps/lore-api/src/transport/routes/trace/trace-failures-touching.test.ts#L54))

The route returns the recorded failures under a `failures` key. ([validated by returns the recorded failures under a failures key](apps/lore-api/src/transport/routes/trace/trace-failures-touching.test.ts#L61))

It asks the graph with the repo and the requested path. ([validated by queries the graph with the repo and the requested path](apps/lore-api/src/transport/routes/trace/trace-failures-touching.test.ts#L68))

With no graph configured it returns an empty list rather than failing — the
same degradation the impact route makes, because an absent graph is a missing
convenience, not a broken build. ([validated by returns an empty list when no Dgraph client is configured](apps/lore-api/src/transport/routes/trace/trace-failures-touching.test.ts#L79))

The tool lists each failure with its node, its attempt, the commit it failed on
and the sha that later fixed it. ([validated by lists each failure with its node, attempt, commit and the sha that fixed it](libs/server-core/src/work/spec-trace/query-trace.test.ts#L408))

A failure no later attempt resolved is marked still open, so a round does not
read an unfixed failure as a solution to copy. ([validated by marks a failure with no resolving commit as still open](libs/server-core/src/work/spec-trace/query-trace.test.ts#L419))

An empty answer renders as a sentence saying so. ([validated by renders a no-recorded-failures sentence for an empty list](libs/server-core/src/work/spec-trace/query-trace.test.ts#L427))

Only the first line of a failure's detail is shown, capped — the point is
recognition, and the whole log lives in the run's pod logs. ([validated by truncates a detail longer than 120 characters to one capped line](libs/server-core/src/work/spec-trace/query-trace.test.ts#L433))

The requested path reaches the proxied URL url-encoded. ([validated by proxies a GET to the repo's failures-touching route with the path url-encoded](libs/server-core/src/work/spec-trace/query-trace.test.ts#L441))

An unreachable API is reported as prose rather than thrown, like every other
shape this tool serves. ([validated by reports the proxy failure rather than throwing when the api is unreachable](libs/server-core/src/work/spec-trace/query-trace.test.ts#L455))

## Out of Scope

- The test-rooted direction ("what does test Y cover") — the `/trace/document`
  route is spec-rooted; that needs a separate read endpoint.
- Free-form natural-language query parsing — the input is structured
  (`spec` + optional `statement`), deterministic, no LLM.
