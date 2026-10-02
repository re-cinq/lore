# Feature Specification: lore_create_pipeline_task MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_create_pipeline_task MCP Tool  |
| Status  | Retired                        |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_create_pipeline_task`         |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

`lore_create_pipeline_task` is the single entry point for delegating work to the Lore pipeline: it validates the description, resolves the repo, enforces the per-repo trust gate, inserts the `pipeline.tasks` row, and tells the caller how the task will be picked up.

> **Retired 2026-10-02.** The tool is removed. `POST /api/task` creates no task from a description (`specs/external-floor` FR16.7), so the tool could only report that refusal. Code reaches an agent through a backlog ticket with a `priority:*` label, a feature through a plan, a review through the pull request. What follows is the record of what the tool did.

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

Registered via `server.tool` ([registration](apps/mcp-server/src/transport/tools/pipeline-tools-lifecycle.ts#L125)).

- **name**: `lore_create_pipeline_task`
- **description** (verbatim):

```text
Enqueues a new server-side pipeline task and returns its UUID and a pickup hint. priority=normal lands in the backlog; priority=immediate the GKE agent picks up within ~30s. This tool only enqueues — it never runs anything on your machine. Instead: lore_run_task_locally to start a new ad-hoc task in a local worktree NOW; lore_claim_and_run_locally to run an existing backlog task locally; lore_sync_tasks to materialize a tasks.md checklist as spec-tasks (not this tool).
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `description` | string | yes | — | Primary natural-language instruction; max 32000 chars, non-empty. |
| `task_type` | string | yes | — | `feature-request` \| `runbook` \| `gap-fill` \| `review`. No default; an unknown or removed type (`implementation`, `general`) is refused. `onboard` is refused here. |
| `target_repo` | string | no | — | `owner/repo`. Auto-detected from git remote when omitted. |
| `priority` | enum | no | `"normal"` | `normal` = backlog; `immediate` = GKE agent auto-executes within ~30s. |
| `group_id` | string | no | — | Task-group UUID to link into a multi-repo feature rollup. |
| `context` | object | no | — | Optional context for the agent: `spec_file`, `branch`, `seed_query`. |

## Behavior

1. **Schema validation** — `description` must be non-blank (Zod `.min(1)` plus a
   trim `.refine`) and at most 32000 chars (`.max(MAX_TASK_DESCRIPTION_CHARS)`); the MCP input schema
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
     `resolvedType = task_type`; a missing or removed type is refused (`namedTaskType`).
     Call `createTask(desc, resolvedType, resolvedRepo, "mcp", context || undefined, priority, group_id)`
     ([handler wrapper](../../../libs/server-core/src/work/pipeline/pipeline.ts#L71)).
4. **Shared CRUD** ([`createTask`](../../../libs/shared/src/domain/pipeline-task-core.ts#L114)) — rejects descriptions
   over 32000 chars; when a repo is set, `SELECT settings FROM lore.repos WHERE full_name = $1`
   and enforce the trust gate (`settings.trust.level` → allowed task types; a
   disallowed type throws `Task type "{t}" not allowed at trust level "{level}" for {repo}. Allowed: …`,
   non-trust query errors are swallowed). Then `INSERT INTO pipeline.tasks
   (description, task_type, target_repo, created_by, context_bundle, priority[, task_group_id])
   … RETURNING id, status, priority, created_at`, optional `UPDATE … SET context_refs`,
   then `recordEvent(pool, id, null, "pending", {created_by, priority})`. ([validated by `inserts task_group_id grp-1 as the seventh insert parameter`](../../../libs/shared/src/domain/pipeline-tasks.trust.test.ts#L88), [validated by `inserts six parameters and no task_group_id column without a group id`](../../../libs/shared/src/domain/pipeline-tasks.trust.test.ts#L106))
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
([validated by `creates a linked task when the original is failed`](apps/mcp-server/src/work/pipeline/pipeline-crud.test.ts#L105))

An empty or whitespace-only description is rejected by the input schema before
any insert; a normal description is accepted.


The target repo defaults to the git remote when `target_repo` is omitted; an
explicit value wins.
*(untested: `detectCurrentRepo()` reads the ambient git remote — no deterministic seam without live repo state.)*

A task must name its type: the input schema rejects a call with no `task_type`, and task creation refuses a missing type and the removed `implementation` and `general` types, pointing at the implementation loop, in the Postgres store and the in-memory one alike.
([validated by answers onboard for a task of type onboard](libs/shared/src/domain/task-types/retired-task-types.test.ts#L5), [validated by refuses a task with no type, pointing at the implementation loop](libs/shared/src/domain/task-types/retired-task-types.test.ts#L9), [validated by refuses the removed %s task type, pointing at the implementation loop](libs/shared/src/domain/task-types/retired-task-types.test.ts#L17), [validated by refuses a task with no type, as the Postgres store does](libs/shared/src/outbound/project/tasks/task-store-memory.test.ts#L99))

A description over 32000 chars (`MAX_TASK_DESCRIPTION_CHARS`, one shared constant) is rejected by the input schema (and, on the DB
path, by the shared CRUD).


`task_type: "onboard"` is refused before the local/remote split and the caller is
pointed at `lore_onboard_repo`, whose transaction holds the duplicate-onboard
guard.

With no `LORE_API_URL`/`LORE_INGEST_TOKEN` configured, the tool returns a
not-configured message; on success the response names the immediate-priority
pickup hint; a 401 is reported as a denied error. ([validated by `returns the
not-configured message when the env is
unset`](apps/mcp-server/src/transport/tools/pipeline-tools.test.ts#L187), [`reports
a denied error on a
401`](apps/mcp-server/src/transport/tools/pipeline-tools.test.ts#L293))

The shared trust gate allows `onboard` at every trust tier — it produces a
docs-only scaffolding PR and is guarded against duplicates by its own route, so
restricting it to `full` would only break the reonboard repair path on
auto-promoted repos — while a genuinely disallowed type is still refused. ([validated by `allows an onboard task at trust level %s`](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L33), [validated by still refuses a spec-task at trust level docs](libs/shared/src/domain/pipeline-tasks.trust.test.ts#L48))

`buildContextBundle` (`apps/lore-api/src/work/pipeline/context-bundle.ts`) assembles this same `context` shape (`pipeline_task_id`, `spec_file`, `seed_query`, `branch`) into the markdown sections handed to an agent: an absent or empty `context` renders an empty string.

Each present field renders its own `## <heading>` section — pipeline task, seed query, or branch — when that field is set alone.

Multiple sections join on `\n\n---\n\n` in field order.

`spec_file: true` reads `.specify/spec.md` and `.specify/constitution.md` from the process cwd when present, adding no section when neither exists, and labels both files Spec because the ".specify" directory name itself contains "spec".

## Out of Scope

- Task execution (handled by the lore-agent service).
- Local claim/run (`lore_claim_and_run_locally`, `lore_run_task_locally`).
- The `lore_sync_tasks` spec-task ingestion path.
- Trust-level configuration (settings UI / `lore.repos.settings.trust`).
