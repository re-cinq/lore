# Feature Specification: lore_get_run_node_logs MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_run_node_logs MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_run_node_logs` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/get-run-node-logs.ts`) |
| Scope   | shared                         |

`lore_get_run_node_logs` reads one station visit's log. Part of user story #4717.

## Problem Statement

A developer, or an agent pod fixing what an earlier station left, needs to see an
assembly-line run without opening the web UI. lore-api already serves every part
of a run; this tool is the MCP door to it.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/get-run-node-logs.ts)), in both laptop and agent mode.

- **name**: `lore_get_run_node_logs`
- **description** (verbatim):

```text
Reads one station visit's log from an assembly-line run, returning {available, logs, phase, archived}. node is a visit's agent_cr_name from lore_get_run's visits (floor-<visitId> on the external floor). Pass tail to read only the last lines. Instead: lore_get_run_transcript for the agent's turns, lore_get_task_logs for a pipeline task.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | The run's id. |
| `node` | string | yes | The visit's node name, `floor-<visitId>` on the external floor. |
| `tail` | integer ≥ 1 | no | Only the last N lines. |

## Behavior

The handler is an API proxy only (ADR-032), through the shared run read
([run-read.ts](apps/mcp-server/src/transport/tools/runs/shared/run-read.ts)):
`GET /api/assembly-runs/{id}/nodes/{name}/logs[?tail]` with the bearer token and a 30 s timeout. lore-api answers the stored stdout of a Postgres run, the floor's log for a `floor-<visitId>` name, and 404 otherwise.

## Output

One MCP text content block: the answer as compact JSON, or the failure text. **Never throws.**

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/get-run-node-logs/spec.md @5d00660e](apps/mcp-server/src/transport/tools/runs/get-run-node-logs.test.ts#L36))

The tool answers the visit's log and passes `tail` through. ([validated by returns the log of visit floor-v1 of run r1 @80f2e7f4](apps/mcp-server/src/transport/tools/runs/get-run-node-logs.test.ts#L17), [validated by asks for the last 50 lines when tail is 50 @3a8c425a](apps/mcp-server/src/transport/tools/runs/get-run-node-logs.test.ts#L28))

Every failure comes back as text: no `LORE_API_URL` answers `"Assembly-line runs require LORE_API_URL."` without fetching, 401/403 the denied error, another status the unreachable error, a thrown fetch `"Error <op>: <message>"`. ([validated by answers the require-URL message without fetching when LORE_API_URL is unset @270b621b](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L10), [validated by reports a denied error on a 403 @a92aa6d5](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L17), [validated by reports HTTP 404 Not Found as unreachable @ed536b55](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L23), [validated by returns 'Error testing: connect ECONNREFUSED' when fetch throws @6f49b810](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L27))

## Out of Scope

- Changing a run: `lore_retry_station` to run a station again; cancelling on the web UI's run page.
- Live following: the `run` channel of the live socket (ADR-048).
