# Feature Specification: lore_get_run_assets MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_run_assets MCP Tool |
| Status  | In Progress                    |
| Created | 2026-11-17                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_run_assets` |
| Module  | runs (`apps/mcp-server/src/transport/tools/runs/get-run-assets.ts`) |
| Scope   | shared                         |

`lore_get_run_assets` lists what a run produced: its bag, a preview of every blob the bag refers to, and the pull request's files. Part of user story #4717.

## Problem Statement

A developer, or an agent pod fixing what an earlier station left, needs to see an
assembly-line run without opening the web UI. lore-api already serves every part
of a run; this tool is the MCP door to it.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/runs/get-run-assets.ts)), in both laptop and agent mode.

- **name**: `lore_get_run_assets`
- **description** (verbatim):

```text
Lists what an assembly-line run produced, returning {bag, previews, pull_files}: each bag item by name with its kind (value, file or git), ref and the station that put it there, the first 4 KiB of every blob the bag refers to, and the pull request's changed files. Instead: lore_get_run_blob for a whole blob.
```

### Input schema (Zod)

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `run_id` | string | yes | The run's id. |

## Behavior

The handler is an API proxy only (ADR-032), through the shared run read
([run-read.ts](apps/mcp-server/src/transport/tools/runs/shared/run-read.ts)):
`GET /api/assembly-runs/{id}/bag and /pull-files in parallel, then /blob-previews?hash=… for the bag's blob refs` with the bearer token and a 30 s timeout. The bag is required. Refs matching `sha256-<64 hex>` are de-duplicated and the first 50 previewed; no blob ref means no preview request. Failed previews or pull files are kept as `{error}`.

## Output

One MCP text content block: the answer as compact JSON, or the failure text. **Never throws.**

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block. ([validated by carries the verbatim description block of specs/mcp-tools/get-run-assets/spec.md @5ac36cb1](apps/mcp-server/src/transport/tools/runs/get-run-assets.test.ts#L62))

The tool answers `{bag, previews, pull_files}`, previewing only the blobs the bag refers to. ([validated by returns the bag, the preview of its blob and the pull files @c5997d14](apps/mcp-server/src/transport/tools/runs/get-run-assets.test.ts#L17), [validated by asks for no previews when the bag holds no blob @199ab10f](apps/mcp-server/src/transport/tools/runs/get-run-assets.test.ts#L39))

A run without a bag fails the read; failed previews are kept as `{error}`. ([validated by fails when the run has no bag @d8e7c557](apps/mcp-server/src/transport/tools/runs/get-run-assets.test.ts#L58), [validated by keeps failed previews as {error: 'HTTP 404 Not Found'} @5b149f88](apps/mcp-server/src/transport/tools/runs/get-run-assets.test.ts#L48))

Every failure comes back as text: no `LORE_API_URL` answers `"Assembly-line runs require LORE_API_URL."` without fetching, 401/403 the denied error, another status the unreachable error, a thrown fetch `"Error <op>: <message>"`. ([validated by answers the require-URL message without fetching when LORE_API_URL is unset @270b621b](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L10), [validated by reports a denied error on a 403 @a92aa6d5](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L17), [validated by reports HTTP 404 Not Found as unreachable @ed536b55](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L23), [validated by returns 'Error testing: connect ECONNREFUSED' when fetch throws @6f49b810](apps/mcp-server/src/transport/tools/runs/shared/run-read.test.ts#L27))

## Out of Scope

- Changing a run: `lore_retry_station` to run a station again; cancelling on the web UI's run page.
- Live following: the `run` channel of the live socket (ADR-048).
