# Feature Specification: lore_create_pipeline_task MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_create_pipeline_task MCP Tool  |
| Status  | **Draft**                      |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_create_pipeline_task`         |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

## Problem Statement

Developers and PMs need a single MCP entry point to delegate work to the Lore
pipeline — generating specs, implementing from a spec, onboarding a repo,
drafting docs — without learning the task-type catalogue, the repo remote, or
whether the server is running locally (stdio proxy) or on GKE (direct DB). The
same call must respect per-repo trust gates so a repo that has not earned
`implementation` trust cannot be made to write code. `lore_create_pipeline_task`
validates the description, resolves the repo, maps the type, inserts the
`pipeline.tasks` row (recording the `pending` event), and tells the caller how
the task will be picked up.

## Interface

Registered via `server.tool` ([registration](../../../apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L25)).

- **name**: `lore_create_pipeline_task`
- **description** (verbatim):

```text
Enqueues a new server-side pipeline task and returns its UUID and a pickup hint. priority=normal lands in the backlog; priority=immediate the GKE agent picks up within ~30s. This tool only enqueues — it never runs anything on your machine. Instead: lore_run_task_locally to start a new ad-hoc task in a local worktree NOW; lore_claim_and_run_locally to run an existing backlog task locally; lore_sync_tasks to materialize a tasks.md checklist as spec-tasks (not this tool).
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `description` | string | yes | — | Primary natural-language instruction; max 10000 chars, non-empty. |
| `task_type` | string | no | `"general"` | `feature-request` \| `onboard` \| `general` \| `runbook` \| `implementation` \| `gap-fill` \| `review`. Unknown → falls back to `general`. |
| `target_repo` | string | no | — | `owner/repo`. Auto-detected from git remote when omitted. |
| `priority` | string | no | `"normal"` | `normal` = backlog; `immediate` = GKE agent auto-executes within ~30s. |
| `group_id` | string | no | — | Task-group UUID to link into a multi-repo feature rollup. |
| `context` | object | no | — | Optional context for the agent: `spec_file`, `branch`, `seed_query`. |

## Behavior

1. **Empty guard** — if `description` is empty or whitespace-only, return
   `"description is required and cannot be empty"` (no insert).
2. **Repo resolution** — `resolvedRepo = target_repo || detectCurrentRepo() || undefined`.
3. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — read `LORE_API_URL` + `LORE_INGEST_TOKEN`.
     If either is missing, return `"Task delegation requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh or set them manually."`
     Otherwise `POST {LORE_API_URL}/api/task` with `Authorization: Bearer {token}`,
     body `{description, task_type, target_repo: resolvedRepo, priority, context}`.
     On non-2xx return `"Remote task creation failed: {error || statusText}"`.
     On success format the success message (below) using `result.task_id` and
     `result.task_type || task_type`.
   - **DB mode (`LORE_DB_HOST` set)** — `validTypes = getTaskTypes()`;
     `resolvedType = validTypes.includes(task_type) ? task_type : "general"`.
     Call `createTask(desc, resolvedType, resolvedRepo, "mcp", context || undefined, priority, group_id)`
     ([handler wrapper](../../../apps/mcp-server/src/features/pipeline/pipeline.ts#L48)).
4. **Shared CRUD** ([`createTask`](../../../libs/shared/src/pipeline-tasks.ts#L35)) — rejects descriptions
   over 10000 chars; when a repo is set, `SELECT settings FROM lore.repos WHERE full_name = $1`
   and enforce the trust gate (`settings.trust.level` → allowed task types; a
   disallowed type throws `Task type "{t}" not allowed at trust level "{level}" for {repo}. Allowed: …`,
   non-trust query errors are swallowed). Then `INSERT INTO pipeline.tasks
   (description, task_type, target_repo, created_by, context_bundle, priority[, task_group_id])
   … RETURNING id, status, priority, created_at`, optional `UPDATE … SET context_refs`,
   then `recordEvent(pool, id, null, "pending", {created_by, priority})`.
5. **Success message** — both transports return:
   `"Task created: {task_id}\nType: {type}\nPriority: {priority}\nRepo: {repo|'default'}\n\n{pickupMsg}"`
   where `pickupMsg` is *"The GKE agent will pick this up within 30 seconds."*
   for `immediate`, else *"Task added to backlog. Claim it locally with
   lore_claim_and_run_locally, or set priority to immediate via the UI."*
6. Any thrown error is caught and returned as `"Error creating pipeline task: {message}"`.

## Output

A single MCP text content block — one of: the empty-description guard, the
stdio-proxy missing-config message, the remote-failure message, the success
message, or the `"Error creating pipeline task: …"` message. **Never throws.**

## Dependencies & side effects

- `detectCurrentRepo()`, `getTaskTypes()`, `getDefaultRepo()` (config),
  `createTask` wrapper → shared `createTask`.
- DB tables: `lore.repos` (trust-gate read), `pipeline.tasks` (insert),
  `pipeline.task_events` (the `pending` event).
- Env: `LORE_DB_HOST` (transport switch), `LORE_API_URL`, `LORE_INGEST_TOKEN` (proxy path).
- POST `/api/task` on the GKE server (stdio path).

## Acceptance Criteria

A valid create inserts a `pipeline.tasks` row, records the `pending` transition
event, and returns the new id with `pending` status — exercised end-to-end via the
retry path, which calls the same shared `createTask`.
([validated by `creates a linked task when the original is failed`](../../../apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L95))

An empty or whitespace-only description is rejected before any insert.
*(untested: the guard is inline in the handler closure and not separately exported.)*

The target repo defaults to the git remote when `target_repo` is omitted; an
explicit value wins.
*(untested: `detectCurrentRepo()` reads the ambient git remote — no deterministic seam without live repo state.)*

A task type outside the known catalogue falls back to `general`.
*(untested: the fallback is inline in the handler closure and not separately exported.)*

A description over 10000 chars is rejected by the shared CRUD.
*(untested: covered by the shared CRUD guard, no dedicated mcp-side test seam.)*

## Out of Scope

- Task execution (handled by the lore-agent service).
- Local claim/run (`lore_claim_and_run_locally`, `lore_run_task_locally`).
- The `lore_sync_tasks` spec-task ingestion path.
- Trust-level configuration (settings UI / `lore.repos.settings.trust`).
