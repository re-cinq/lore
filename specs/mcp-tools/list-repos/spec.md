# Feature Specification: lore_list_repos MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_list_repos MCP Tool            |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_list_repos`                   |
| Module  | Repo (`repo-tools.ts`)         |
| Scope   | shared                         |

## Problem Statement

A developer or agent inspecting the Lore deployment needs to know which repos
have been onboarded and how much pipeline activity each has seen, without
opening the web UI or querying Postgres by hand. `lore_list_repos` returns the full
`lore.repos` table joined with a per-repo pipeline task count in one call.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/repo-tools.ts#L14)).

- **name**: `lore_list_repos`
- **description** (verbatim):

```text
Lists every repo onboarded into Lore, returning a JSON array with per-repo metadata and pipeline task count (DB-only). Instead: to add a repo use lore_onboard_repo; to list pipeline tasks use lore_list_pipeline_tasks.
```

### Input schema (Zod)

The tool takes no parameters — the schema object is `{}`.

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| — | — | — | — | No inputs. |

## Behavior

1. **Availability gate** — if `process.env.LORE_DB_HOST` is unset, return the
   literal text `"Repo management requires PostgreSQL (LORE_DB_HOST not set)."`
2. Call `getOnboardedReposWithCounts(getPool()!)`
   ([handler](../../../apps/mcp-server/src/features/repo/repo-onboard.ts#L80)), which runs a
   single `SELECT` over `lore.repos r LEFT JOIN (SELECT target_repo, COUNT(*) AS
   task_count FROM pipeline.tasks GROUP BY target_repo) tc ON tc.target_repo =
   r.full_name`, projecting `id, owner, name, full_name, team, onboarded_at,
   last_ingested_at, onboarding_pr_url, onboarding_pr_merged, settings,
   COALESCE(tc.task_count, 0)::int AS task_count`, ordered by `r.onboarded_at
   DESC`.
3. **Empty guard** — if the result array is empty, return the literal text
   `"No repos onboarded yet. Use lore_onboard_repo to add one."` ([validated by `repo-tools.test.ts:128`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L128))
4. **Success envelope** — return `JSON.stringify(repos, null, 2)`.
5. Any thrown error is caught and returned as `"Error listing repos: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the
PostgreSQL-required text, the "No repos onboarded yet" text, the pretty-printed
JSON array of repo rows (each carrying an integer `task_count`), or the
`"Error listing repos: …"` text. **Never throws** — every path returns text.

## Dependencies & side effects

- `getPool()` (pg pool; non-null asserted after the `LORE_DB_HOST` gate).
- `getOnboardedReposWithCounts` — one read of `lore.repos` joined to a
  `pipeline.tasks` count aggregate. Read-only; no writes.
- Env: `LORE_DB_HOST` (presence gate only).

## Acceptance Criteria

The query joins `lore.repos` to a `pipeline.tasks` count aggregate and projects
`task_count` as a coalesced integer per repo. *(untested: `getOnboardedReposWithCounts`
is a single inline `SELECT` with no pure seam; verified against live Postgres /
the web-ui repo-status path.)*

The handler returns the no-repos guidance string when the table is empty and the
JSON array otherwise. *(untested: handler orchestration around the query has no
unit seam — the empty and populated branches need a live DB.)*

## Out of Scope

- Onboarding new repos — owned by [`onboard-repo`](../onboard-repo/spec.md).
- The web UI repo list / repo-status route.
- Cross-schema chunk counts (web-ui `queryAllChunks`).
