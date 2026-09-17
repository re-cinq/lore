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

`lore_onboard_repo` registers a GitHub repo in Lore and spawns an onboard pipeline task: the Floor enrols the repo and the `onboard` assembly line authors AGENTS.md, ADRs, spec and templates from the onboarding ticket and opens the one PR asynchronously.

## Problem Statement

Adding a repo to Lore requires both a registry row in `lore.repos` and an
onboard task whose ticket the `onboard` assembly line implements into one
onboarding PR (workflows, templates, AGENTS.md, ADRs, spec). `lore_onboard_repo`
does both atomically from a single `owner/repo` argument: it upserts the
registry row and spawns the `onboard` pipeline task.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/repo-tools.ts#L84)).

- **name**: `lore_onboard_repo`
- **description** (verbatim):

```text
Registers a new GitHub repo with Lore and spawns an onboard pipeline task: the Floor enrols the repo (labels, webhook, ingest callback, verbatim workflows) and the onboard assembly line authors AGENTS.md/PR-template/ADRs/spec from the onboarding ticket and opens the ONE PR asynchronously; returns { repo_id, task_id, status }. Refuses (HTTP 409) when the repo is already onboarded, still has its onboarding PR open, or already has an onboard task in flight — pass reonboard to regenerate missing scaffolding for an onboarded repo. Instead: to list repos use lore_list_repos; to push files into an already-onboarded repo use lore_ingest_files.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `full_name` | string | yes | — | "owner/repo" format; both segments must be non-empty. |

## Behavior

1. **Availability gate** — if `process.env.LORE_DB_HOST` is unset, return the
   literal text `"Repo onboarding requires PostgreSQL (LORE_DB_HOST not set)."`
2. Call `onboardRepo(getPool()!, full_name)`
   ([handler](../../../apps/lore-api/src/work/repo/repo-onboard.ts#L256)):
   1. Split `full_name` on `/`. If either `owner` or `name` is empty, throw
      `Invalid repo full_name: "{fullName}". Expected "owner/repo" format.`
   2. Upsert into `lore.repos (owner, name, full_name)` with
      `ON CONFLICT (full_name) DO UPDATE SET onboarded_at = now()`,
      `RETURNING id` — re-onboarding refreshes the timestamp rather than
      erroring.
   3. Create an `onboard` pipeline task inside the guarded transaction:
      description = `onboardTicketBody(full_name)` (the onboarding ticket the
      `onboard` line implements), target_repo = `full_name`, created_by =
      `onboard-system`, context_bundle = `{ repo: full_name }`.
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
- The actual PR creation happens later: the Floor's `handleOnboard` enrols the
  repo and commits the verbatim scaffold, and the `onboard` assembly line's push
  node opens the PR — never this handler.

## Acceptance Criteria

The `/api/onboard` route returns 503 when the pool is null. ([validated by `onboard.test.ts:42`](apps/lore-api/src/transport/routes/repos/onboard.test.ts#L42))

The route returns 400 for a malformed (`owner/repo`-less) repo argument. ([validated by `onboard.test.ts:48`](apps/lore-api/src/transport/routes/repos/onboard.test.ts#L48))

A well-formed repo returns the onboard result on 200. ([validated by `onboard.test.ts:54`](apps/lore-api/src/transport/routes/repos/onboard.test.ts#L54))

A 409 from the route is the guard refusing a duplicate, not an outage: the tool
returns the refusal body verbatim so the caller keeps `blocked` and the in-flight
`task_id`, while a genuine transport failure still reports as unreachable. The
`reonboard` flag is passed straight through. ([validated by `returns the guard's refusal body verbatim on a 409`](apps/mcp-server/src/transport/tools/repo-tools.test.ts#L183), [`still reports a genuine outage as unreachable`](apps/mcp-server/src/transport/tools/repo-tools.test.ts#L203), [`passes reonboard through to the API`](apps/mcp-server/src/transport/tools/repo-tools.test.ts#L215))

The MCP-tool wrapper's own `LORE_DB_HOST` gate and JSON-envelope framing reuse
the same `onboardRepo` handler the route covers. *(untested: the tool wrapper has
no unit seam distinct from the route; `onboardRepo` itself writes to two tables
and spawns a task, needing a live DB.)*

## Out of Scope

- The `onboard` agent task itself — repo inspection, CLAUDE.md generation, PR
  authoring.
- Listing onboarded repos — owned by [`list-repos`](../list-repos/spec.md).
- Installation-repo discovery (`getInstallationRepos` / `getAvailableRepos`).
