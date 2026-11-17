# Feature Specification: lore_retry_station MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_retry_station MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_retry_station` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/retry-station.ts`) |
| Scope   | shared                         |

`lore_retry_station` runs one station of an assembly-line run again: the MCP twin of the run page's "Run this station" button. Part of user story #4717, ticket #4727.

## Problem Statement

A developer, or an agent that finds a failed run, wants to run the failed station
again without opening the run page. lore-api already serves this; the tool is the
MCP door to it. It spawns work, so on the agent gateway it must not let an agent
restart the run it is running in.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/retry-station.ts)), in both laptop and agent mode.

- **name**: `lore_retry_station`
- **description** (verbatim):

```text
Runs one station of an assembly-line run again, returning {run_id, pending}; the floor reopens a finished or failed run to take it, and pending is true when it had not taken the ask within a few seconds. node is a node id of the run's line, from lore_get_run. On the agent gateway a run that is still queued or running is refused, so an agent cannot restart its own run. Instead: lore_get_run to see which station failed.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | The run's id. |
| `node` | string | yes | The node id of the station to run again. |

## Behavior

`POST /api/assembly-runs/{id}/nodes/{node}/run` (scope `task`) with
`{requested_by}`: `lore-mcp:<os user>` on a laptop, `lore-mcp:agent` on the
gateway. A person's session login, when the token carries one, wins on the server.

### Rationale

The gateway serves every pod with one static token and receives no run id, so it
cannot tell a pod's own run from another. An agent's own run is always open while
the agent works, so refusing every open run is enough to keep an agent from
restarting itself, with no identity at all.

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/retry-station/spec.md @2c77d3b6](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L77))

On a laptop the tool asks lore-api to run the station again in the laptop user's name and answers `{run_id, pending}`. ([validated by asks for station tdd-round of run r1 again in the laptop user's name @5858e1ff](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L18))

On the agent gateway the tool first reads the run; a queued or running run is answered `{refused}` without asking the floor, a settled one is run again as `lore-mcp:agent`, and an unknown run fails the read. ([validated by refuses an agent a station of running run r1 without asking the floor @9a95a1a9](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L33), [validated by asks for a station of failed run r1 again as lore-mcp:agent @e6b178a1](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L43), [validated by reports an agent's retry of unknown run r1 as HTTP 404 Not Found @bc0fcccf](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L56))

A 4xx answer is reported as `The Lore API refused lore_retry_station: HTTP <status> <text>: <reason>`, the reason read from the body's `message`. ([validated by reports the floor's 409 reason 'run was cancelled' as a refusal @d522dc58](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L61), [validated by reports a 400 with no body as refused with no reason given @f6d2ca36](apps/mcp-server/src/transport/tools/runs/retry-station.test.ts#L69))

## Out of Scope

- Starting a line: each line has its own entry point (backlog label, onboarding, `/api/review/start`).
- Cancelling a run.
