# Feature Specification: lore_get_run_blob MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_run_blob MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_run_blob` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/get-run-blob.ts`) |
| Scope   | shared                         |

`lore_get_run_blob` reads one blob a run refers to. Part of user story #4717.

## Problem Statement

A developer, or an agent pod fixing what an earlier station left, needs to see an
assembly-line run without opening the web UI. lore-api already serves every part
of a run; this tool is the MCP door to it.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/get-run-blob.ts)), in both laptop and agent mode.

- **name**: `lore_get_run_blob`
- **description** (verbatim):

```text
Reads one blob an assembly-line run refers to, returning {hash, contentType, size, text, truncated}: the text of a textual blob up to 1 MiB, only the metadata otherwise. hash comes from lore_get_run_assets. A blob never changes, so it is cached for a day.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | The run's id. |
| `hash` | string | yes | `sha256-<64 hex>`; anything else is refused by the input schema. |

## Behavior

The handler is an API proxy only (ADR-032), through the shared run read
([run-read.ts](apps/mcp-server/src/transport/tools/runs/shared/run-read.ts)):
`GET /api/assembly-runs/{id}/blobs/{hash}` with the bearer token and a 30 s timeout. lore-api serves a blob only through a run that references it: text up to 1 MiB for a textual type, metadata otherwise. A blob is content-addressed, so the answer is cached for 86400 s.

## Output

One MCP text content block: the answer as compact JSON, or the failure text. **Never throws.**

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/get-run-blob/spec.md @740ef794](apps/mcp-server/src/transport/tools/runs/get-run-blob.test.ts#L46))

The tool answers the blob and serves a second read from the cache. ([validated by returns the text of blob sha256-bbb… of run r1 @0449299b](apps/mcp-server/src/transport/tools/runs/get-run-blob.test.ts#L23), [validated by serves the blob from the cache on the second read @4dee82f0](apps/mcp-server/src/transport/tools/runs/get-run-blob.test.ts#L37))

Every failure comes back as text: no `LORE_API_URL` answers `"Assembly-line runs require LORE_API_URL."` without fetching, 401/403 the denied error, another status the unreachable error, a thrown fetch `"Error <op>: <message>"`. ([validated by answers the require-URL message without fetching when LORE_API_URL is unset @270b621b](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L10), [validated by reports a denied error on a 403 @a92aa6d5](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L17), [validated by reports HTTP 404 Not Found as unreachable @ed536b55](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L23), [validated by returns 'Error testing: connect ECONNREFUSED' when fetch throws @6f49b810](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L27))

## Out of Scope

- Changing a run (cancel, run a station): the web UI's run page.
- Live following: the `run` channel of the live socket (ADR-048).
