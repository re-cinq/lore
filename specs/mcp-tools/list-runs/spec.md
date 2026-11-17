# Feature Specification: lore_list_runs MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_list_runs MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_list_runs` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/list-runs.ts`) |
| Scope   | shared                         |

`lore_list_runs` lists the floor's runs a page at a time, newest first, filtered by repository, status and line. Part of user story #4717.

## Problem Statement

A developer, or an agent pod fixing what an earlier station left, needs to see an
assembly-line run without opening the web UI. lore-api already serves every part
of a run; this tool is the MCP door to it.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/list-runs.ts)), in both laptop and agent mode.

- **name**: `lore_list_runs`
- **description** (verbatim):

```text
Lists assembly-line runs on the floor, newest first, a page at a time, returning {runs, next_cursor}; each run carries its id, line, status, repository and stages. Pass next_cursor back as cursor for the next page. Instead: lore_get_run for one run's stations, Definition of Done and tokens.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `repo` | string | no | 'owner/repo'; a laptop defaults to the git remote's repository, the agent gateway to every repository. An invalid name is refused without fetching. |
| `status` | string | no | Run status filter. |
| `line` | string | no | Assembly line filter. |
| `cursor` | string | no | `next_cursor` of the previous page. |
| `limit` | integer 1-100 | no | Runs per page. |

## Behavior

The handler is an API proxy only (ADR-032), through the shared run read
([run-read.ts](apps/mcp-server/src/transport/tools/runs/shared/run-read.ts)):
`GET /api/floor-runs?repo&status&line&cursor&limit` with the bearer token and a 30 s timeout. Only the given parameters are sent, in the order repo, status, line, cursor, limit.

## Output

One MCP text content block: the answer as compact JSON, or the failure text. **Never throws.**

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/list-runs/spec.md @9bb6dcec](apps/mcp-server/src/transport/tools/runs/list-runs.test.ts#L53))

The tool answers the floor's page of runs as `{runs, next_cursor}` and sends only the filters the caller gave. ([validated by returns the floor's page of runs for every repository on the agent gateway @bff8c610](apps/mcp-server/src/transport/tools/runs/list-runs.test.ts#L12), [validated by asks for repo re-cinq/lore, failed status, page c2 and 5 runs @1df66972](apps/mcp-server/src/transport/tools/runs/list-runs.test.ts#L21), [validated by filters to the git remote's repository on a laptop @c4c299b6](apps/mcp-server/src/transport/tools/runs/list-runs.test.ts#L43))

An invalid repository name is refused before any request. ([validated by refuses repo '../x' without fetching @9a019c94](apps/mcp-server/src/transport/tools/runs/list-runs.test.ts#L38))

Every failure comes back as text: no `LORE_API_URL` answers `"Assembly-line runs require LORE_API_URL."` without fetching, 401/403 the denied error, another status the unreachable error, a thrown fetch `"Error <op>: <message>"`. ([validated by answers the require-URL message without fetching when LORE_API_URL is unset @270b621b](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L10), [validated by reports a denied error on a 403 @a92aa6d5](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L17), [validated by reports HTTP 404 Not Found as unreachable @ed536b55](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L23), [validated by returns 'Error testing: connect ECONNREFUSED' when fetch throws @6f49b810](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L27))

## Out of Scope

- Changing a run (cancel, run a station): the web UI's run page.
- Live following: the `run` channel of the live socket (ADR-048).
