# Feature Specification: lore_get_run_transcript MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_run_transcript MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_run_transcript` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/get-run-transcript.ts`) |
| Scope   | shared                         |

`lore_get_run_transcript` reads a run's agent turns a page at a time, or one visit's events. Part of user story #4717.

## Problem Statement

A developer, or an agent pod fixing what an earlier station left, needs to see an
assembly-line run without opening the web UI. lore-api already serves every part
of a run; this tool is the MCP door to it.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/get-run-transcript.ts)), in both laptop and agent mode.

- **name**: `lore_get_run_transcript`
- **description** (verbatim):

```text
Reads an assembly-line run's agent turns, oldest first, a page at a time, returning {turns, hasMore}; pass the last turn's id as after for the next page. With visit_id it returns that one visit's events instead, {events}. Instead: lore_get_run_node_logs for a visit's raw log.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | The run's id. |
| `visit_id` | string | no | Read this visit's events instead of the turns. |
| `after` | string | no | The id of the last turn already read. |
| `limit` | integer 1-500 | no | Turns per page. |

## Behavior

The handler is an API proxy only (ADR-032), through the shared run read
([run-read.ts](apps/mcp-server/src/transport/tools/runs/shared/run-read.ts)):
`GET /api/assembly-runs/{id}/turns[?after&limit], or /visits/{visitId}/events` with the bearer token and a 30 s timeout. Turns come oldest first as `{turns, hasMore}`; with `visit_id` the answer is `{events}` and `after`/`limit` are ignored.

## Output

One MCP text content block: the answer as compact JSON, or the failure text. **Never throws.**

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/get-run-transcript/spec.md @9589732d](apps/mcp-server/src/transport/tools/runs/get-run-transcript.test.ts#L45))

The tool pages the run's turns with `after` and `limit`. ([validated by returns the first page of run r1's turns @6f9b54c1](apps/mcp-server/src/transport/tools/runs/get-run-transcript.test.ts#L17), [validated by asks for 20 turns after turn 41 @1608eb80](apps/mcp-server/src/transport/tools/runs/get-run-transcript.test.ts#L29))

With `visit_id` it answers that visit's events. ([validated by reads visit v1's events when visit_id is v1 @e3f00296](apps/mcp-server/src/transport/tools/runs/get-run-transcript.test.ts#L37))

Every failure comes back as text: no `LORE_API_URL` answers `"Assembly-line runs require LORE_API_URL."` without fetching, 401/403 the denied error, another status the unreachable error, a thrown fetch `"Error <op>: <message>"`. ([validated by answers the require-URL message without fetching when LORE_API_URL is unset @270b621b](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L10), [validated by reports a denied error on a 403 @a92aa6d5](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L17), [validated by reports HTTP 404 Not Found as unreachable @ed536b55](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L23), [validated by returns 'Error testing: connect ECONNREFUSED' when fetch throws @6f49b810](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L27))

## Out of Scope

- Changing a run: `lore_retry_station` to run a station again; cancelling on the web UI's run page.
- Live following: the `run` channel of the live socket (ADR-048).
