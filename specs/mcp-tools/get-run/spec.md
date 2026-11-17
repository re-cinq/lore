# Feature Specification: lore_get_run MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_run MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_run` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/get-run.ts`) |
| Scope   | shared                         |

`lore_get_run` reads one run with its station visits and its Definition of Done in one call. Part of user story #4717.

## Problem Statement

A developer, or an agent pod fixing what an earlier station left, needs to see an
assembly-line run without opening the web UI. lore-api already serves every part
of a run; this tool is the MCP door to it.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/get-run.ts)), in both laptop and agent mode.

- **name**: `lore_get_run`
- **description** (verbatim):

```text
Reads one assembly-line run by id, returning {run, visits, dod}: run.line is the run with its status and the graph it walked; visits are its station visits in visit order, each with node_id, status, outcome, failure_detail, agent_cr_name, needs and produced; dod is the Definition of Done progress. A part the run lacks comes back as {error}. Instead: lore_get_run_node_logs for one visit's log, lore_get_run_transcript for the agent turns, lore_list_runs for the run's cost.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | The run's id; URL-encoded into the path. |

## Behavior

The handler is an API proxy only (ADR-032), through the shared run read
([run-read.ts](apps/mcp-server/src/transport/tools/runs/shared/run-read.ts)):
`GET /api/assembly-runs/{id}, /nodes and /dod, in parallel` with the bearer token and a 30 s timeout. The run itself is required: its failure is the tool's answer. `visits` (`/nodes`) carries what the run read's graph projection leaves out: each visit's status, failure_detail, station_run_id, needs and produced. `visits` and `dod` are optional and each is kept as `{error}` when it fails. Tokens are not read: `/token-usage` counts only turns stored in Postgres and answers zero for a floor run; the run's cost is on `lore_list_runs`.

## Output

One MCP text content block: the answer as compact JSON, or the failure text. **Never throws.**

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/get-run/spec.md @7ab9a433](apps/mcp-server/src/transport/tools/runs/get-run.test.ts#L43))

The tool joins the run, its visits and its DoD into one object. ([validated by joins run r1 with its visits and dod @945d029a](apps/mcp-server/src/transport/tools/runs/get-run.test.ts#L12), [validated by encodes run id 'a/b' as a%2Fb @61178c84](apps/mcp-server/src/transport/tools/runs/get-run.test.ts#L37))

A part the run lacks is kept as `{error}` instead of failing the read. ([validated by keeps a run without a dod as dod {error: 'HTTP 404 Not Found'} @82814c49](apps/mcp-server/src/transport/tools/runs/get-run.test.ts#L29))

Every failure comes back as text: no `LORE_API_URL` answers `"Assembly-line runs require LORE_API_URL."` without fetching, 401/403 the denied error, another status the unreachable error, a thrown fetch `"Error <op>: <message>"`. ([validated by answers the require-URL message without fetching when LORE_API_URL is unset @270b621b](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L10), [validated by reports a denied error on a 403 @a92aa6d5](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L17), [validated by reports HTTP 404 Not Found as unreachable @ed536b55](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L23), [validated by returns 'Error testing: connect ECONNREFUSED' when fetch throws @6f49b810](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L27))

The parts are read in parallel and merged into one object keyed by part; a failed required part fails the read, a failed optional part is kept as `{error}`. ([validated by merges parts a and b into {a, b} @d0db7f68](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L37), [validated by keeps a missing optional part as {error: 'HTTP 404 Not Found'} @eaaac605](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L50), [validated by fails the read when the required part answers 404 @1dbcdfee](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L62), [validated by keeps a not-configured optional part as {error: 'not_configured'} @8e1dc821](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L72))

## Out of Scope

- Changing a run: `lore_retry_station` to run a station again; cancelling on the web UI's run page.
- Live following: the `run` channel of the live socket (ADR-048).
