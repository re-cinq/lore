# Feature Specification: lore_onboard_repo MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_onboard_repo MCP Tool          |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_onboard_repo`                 |
| Module  | Repo (`repo-tools.ts`)         |
| Scope   | shared                         |

`lore_onboard_repo` registers a GitHub repo in Lore and spawns an onboard pipeline task that authors CLAUDE.md, AGENTS.md, and CI workflows and opens a PR asynchronously.

## Problem Statement

Adding a repo to Lore requires both a registry row in `lore.repos` and an agent
pass that inspects the repo and opens an onboarding PR (CLAUDE.md, AGENTS.md, PR
template, CI workflows). `lore_onboard_repo` does both atomically from a single
`owner/repo` argument: it upserts the registry row and spawns the `onboard`
pipeline task.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/repo-tools.ts#L84)).

- **name**: `lore_onboard_repo`
- **description** (verbatim):

```text
Registers a new GitHub repo with Lore and spawns an onboard pipeline task that authors CLAUDE.md/AGENTS.md/PR-template and opens a PR asynchronously; returns { repo_id, task_id, status } (DB-only). Re-onboarding an existing repo refreshes onboarded_at. Instead: to list repos use lore_list_repos; to push files into an already-onboarded repo use lore_ingest_files.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `full_name` | string | yes | — | "owner/repo" format; both segments must be non-empty. |

## Behavior

1. **Availability gate** — if `process.env.LORE_DB_HOST` is unset, return the
   literal text `"Repo onboarding requires PostgreSQL (LORE_DB_HOST not set)."`
2. Call `onboardRepo(getPool()!, full_name)`
   ([handler](../../../apps/lore-api/src/features/repo/repo-onboard.ts#L256)):
   1. Split `full_name` on `/`. If either `owner` or `name` is empty, throw
      `Invalid repo full_name: "{fullName}". Expected "owner/repo" format.`
   2. Upsert into `lore.repos (owner, name, full_name)` with
      `ON CONFLICT (full_name) DO UPDATE SET onboarded_at = now()`,
      `RETURNING id` — re-onboarding refreshes the timestamp rather than
      erroring.
   3. Dynamic-import `createTask` from `../pipeline/pipeline.js` and create an
      `onboard` pipeline task: description = `full_name`, target_repo =
      `full_name`, created_by = `onboard-system`, context_bundle =
      `{ repo: full_name }`.
   4. Return `{ repo_id, task_id, status: 'onboarding-agent-spawned' }`.
3. **Success envelope** — return `JSON.stringify(result, null, 2)`.
4. Any thrown error is caught and returned as `"Error onboarding repo: {message}"`.

## Output

A single MCP text content block. One of, in priority order: the
PostgreSQL-required text, the pretty-printed JSON `{ repo_id, task_id, status }`
result, or the `"Error onboarding repo: …"` text (including the malformed-name
case). **Never throws** — every path returns text.

## Dependencies & side effects

- `getPool()` (pg pool; non-null asserted after the `LORE_DB_HOST` gate).
- `onboardRepo` — **writes** an upsert row to `lore.repos` and **inserts** an
  `onboard` task to `pipeline.tasks` (via `createTask`, which also records a
  `pending` task event).
- Env: `LORE_DB_HOST` (presence gate only).
- The actual PR creation (branch, files, PR) happens later in the spawned
  `onboard` agent task, not in this handler.

## Acceptance Criteria

The `/api/onboard` route returns 503 when the pool is null. ([validated by `onboard.test.ts:42`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L42))

The route returns 400 for a malformed (`owner/repo`-less) repo argument. ([validated by `onboard.test.ts:48`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L48))

A well-formed repo returns the onboard result on 200. ([validated by `onboard.test.ts:54`](apps/lore-api/src/api/routes/repos/onboard.test.ts#L54))

A 409 from the route is the guard refusing a duplicate, not an outage: the tool
returns the refusal body verbatim so the caller keeps `blocked` and the in-flight
`task_id`, while a genuine transport failure still reports as unreachable. The
`reonboard` flag is passed straight through. ([validated by `returns the guard's refusal body verbatim on a 409`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L83), [`still reports a genuine outage as unreachable`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L103), [`passes reonboard through to the API`](apps/mcp-server/src/mcp/tools/repo-tools.test.ts#L115))

The MCP-tool wrapper's own `LORE_DB_HOST` gate and JSON-envelope framing reuse
the same `onboardRepo` handler the route covers. *(untested: the tool wrapper has
no unit seam distinct from the route; `onboardRepo` itself writes to two tables
and spawns a task, needing a live DB.)*

## Out of Scope

- The `onboard` agent task itself — repo inspection, CLAUDE.md generation, PR
  authoring.
- Listing onboarded repos — owned by [`list-repos`](../list-repos/spec.md).
- Installation-repo discovery (`getInstallationRepos` / `getAvailableRepos`).
