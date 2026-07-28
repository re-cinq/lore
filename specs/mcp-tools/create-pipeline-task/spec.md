# Feature Specification: lore_create_pipeline_task MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_create_pipeline_task MCP Tool  |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_create_pipeline_task`         |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_create_pipeline_task` is the single entry point for delegating work to the Lore pipeline: it validates the description, resolves the repo, enforces the per-repo trust gate, inserts the `pipeline.tasks` row, and tells the caller how the task will be picked up.

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

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L25)).

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
| `priority` | enum | no | `"normal"` | `normal` = backlog; `immediate` = GKE agent auto-executes within ~30s. |
| `group_id` | string | no | — | Task-group UUID to link into a multi-repo feature rollup. |
| `context` | object | no | — | Optional context for the agent: `spec_file`, `branch`, `seed_query`. |

## Behavior

1. **Schema validation** — `description` must be non-blank (Zod `.min(1)` plus a
   trim `.refine`) and at most 10000 chars (`.max(10000)`); the MCP input schema
   rejects an empty, whitespace-only, or over-length value before the handler runs
   (no insert).
2. **Repo resolution** — `resolvedRepo = target_repo || detectCurrentRepo() || undefined`.
3. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — read `LORE_API_URL` + `LORE_INGEST_TOKEN`.
     If either is missing, return the shared `notConfiguredError("creating a pipeline task")`.
     Otherwise `POST {LORE_API_URL}/api/task` with `Authorization: Bearer {token}`,
     body `{description, task_type, target_repo: resolvedRepo, priority, group_id, context}`.
     A thrown `fetch` (network failure) returns `unreachableError`; a `401`/`403`
     returns `deniedError`; any other non-2xx returns
     `"Remote task creation failed: {error || statusText}"`.
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
([validated by `creates a linked task when the original is failed`](apps/mcp-server/src/features/pipeline/pipeline-crud.test.ts#L113))

An empty or whitespace-only description is rejected by the input schema before
any insert; a normal description is accepted.
([validated by `rejects an empty task description`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L114), [validated by `rejects a whitespace-only task description`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L122), [validated by `accepts an in-range task description`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L130))

The target repo defaults to the git remote when `target_repo` is omitted; an
explicit value wins.
*(untested: `detectCurrentRepo()` reads the ambient git remote — no deterministic seam without live repo state.)*

A task type outside the known catalogue falls back to `general`.
*(untested: the fallback is inline in the handler closure and not separately exported.)*

A description over 10000 chars is rejected by the input schema (and, on the DB
path, by the shared CRUD).
([validated by `rejects a task description over 10000 chars`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L106))

`task_type: "onboard"` is refused before the local/remote split and the caller is
pointed at `lore_onboard_repo`, whose transaction holds the duplicate-onboard
guard. ([validated by `refuses task_type onboard and names lore_onboard_repo instead`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L213))

The shared trust gate allows `onboard` at every trust tier — it produces a
docs-only scaffolding PR and is guarded against duplicates by its own route, so
restricting it to `full` would only break the reonboard repair path on
auto-promoted repos — while a genuinely disallowed type is still refused. ([validated by `allows an onboard task at trust level %s`](libs/shared/src/pipeline-tasks.trust.test.ts#L37), [`still refuses an implementation task at trust level docs`](libs/shared/src/pipeline-tasks.trust.test.ts#L52))

## Out of Scope

- Task execution (handled by the lore-agent service).
- Local claim/run (`lore_claim_and_run_locally`, `lore_run_task_locally`).
- The `lore_sync_tasks` spec-task ingestion path.
- Trust-level configuration (settings UI / `lore.repos.settings.trust`).
