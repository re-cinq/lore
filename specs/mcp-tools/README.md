# MCP Tools — spec index

One spec per Lore MCP **tool** (the `server.tool(...)` registrations exposed to
agents over the MCP protocol). Each spec is reconstruction-grade — interface,
behavior, output, dependencies, and acceptance criteria linked to the tool's
tests (`VALIDATED_BY`) and handler source (`IMPLEMENTED_BY`) — so the
spec-traceability graph shows what implements and tests each tool.

This index replaces the former scattered tool documentation (the
`contracts/mcp-tools.md` files and the FR-2 list in `1-lore-platform`).

> Scope: `shared` tools run on the GKE server and locally; `local` tools are
> registered only in stdio mode and gated by the execution trust boundary.
> `lore-query-trace` is specced + implemented separately (PR #526).

## Conventions (shared by every tool spec)

Each per-tool spec documents only what is *specific* to that tool. The framework
boilerplate below is identical across all tools and is stated once here, so a
tool's spec + this section together are sufficient to recreate the handler.

- **Registration**: `server.tool(name, description, zodInputShape, handler)` —
  the input schema is a raw Zod shape object (not a wrapped `z.object`), keyed by
  param name, each field `.describe(...)`d. Registered inside the module's
  `registerXTools(server, deps)` function.
- **Return envelope**: every handler returns `{ content: [{ type: "text" as const, text }] }`.
  Handlers **never throw** — they catch and return the error as text. (Several wrap
  the body in `trackLatency(name, …)`, which records latency to `memory.audit_log`.)
- **DB access**: the pg pool comes from `deps.getPool()` (may be `null` until
  `main()` initializes it — tools null-check it). Availability is gated on
  `isDbAvailable()` / `isMemoryDbAvailable()` or `process.env.LORE_DB_HOST`.
- **Pipeline CRUD** lives in `@re-cinq/lore-shared` (`createTask`, `getTask`,
  `listTasks`, `cancelTask`, `retryTask`, `updateTaskStatus`, `recordEvent`),
  re-exported from `mcp-server/src/features/pipeline/pipeline.ts` as thin
  `getPool()`-binding wrappers (`cancelTask = (id) => cancelPipelineTask(getPool(), id)`).
- **Repo detection**: `detectCurrentRepo()` (parses the git remote) when a `repo`
  param is omitted.
- **Stdio proxy**: in local stdio mode (no `LORE_DB_HOST`), tools that need the
  shared backend proxy to `LORE_API_URL` with `Authorization: Bearer
  ${LORE_INGEST_TOKEN}` (helpers `proxyToApi` / `proxyGetApi`); a tool that lacks
  a proxy path says so in its Behavior.
- **Imports** are ESM with `.js` specifiers; shared symbols import from
  `@re-cinq/lore-shared`.

## Context (`context-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_assemble_context` | [spec](assemble-context/spec.md) | Assemble token-budgeted context from all sources for turn 1. | shared |
| `lore_search_context` | [spec](search-context/spec.md) | Keyword/passage search over ingested `.md` context. | shared |

## Memory (`memory-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_write_memory` | [spec](write-memory/spec.md) | Store a key/value memory (with versioning). | shared |
| `lore_read_memory` | [spec](read-memory/spec.md) | Retrieve a memory by key (+ version history). | shared |
| `lore_delete_memory` | [spec](delete-memory/spec.md) | Soft-delete a memory. | shared |
| `lore_list_memories` | [spec](list-memories/spec.md) | Paginated listing of active memories. | shared |
| `lore_search_memory` | [spec](search-memory/spec.md) | Semantic search across memories + facts. | shared |
| `lore_write_episode` | [spec](write-episode/spec.md) | Ingest raw text; extract facts + graph. | shared |
| `lore_query_graph` | [spec](query-graph/spec.md) | Query the live knowledge graph. | shared |
| `lore_agent_stats` | [spec](agent-stats/spec.md) | Agent health + memory/episode/fact counts. | shared |

## Pipeline (`pipeline-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_create_pipeline_task` | [spec](create-pipeline-task/spec.md) | Create a pipeline task. | shared |
| `lore_get_pipeline_status` | [spec](get-pipeline-status/spec.md) | Get one task's status. | shared |
| `lore_list_pipeline_tasks` | [spec](list-pipeline-tasks/spec.md) | List pipeline tasks. | shared |
| `lore_cancel_task` | [spec](cancel-task/spec.md) | Cancel a task. | shared |
| `lore_retry_task` | [spec](retry-task/spec.md) | Retry a failed task. | shared |
| `lore_list_task_group` | [spec](list-task-group/spec.md) | List tasks in a multi-repo group. | shared |
| `lore_get_pr_status` | [spec](get-pr-status/spec.md) | Computed PR status for a task. | shared |
| `lore_get_task_logs` | [spec](get-task-logs/spec.md) | Read a task's logs from GCS. | shared |
| `lore_get_job_logs` | [spec](get-job-logs/spec.md) | Read a job run's logs from GCS. | shared |
| `lore_sync_tasks` | [spec](sync-tasks/spec.md) | Sync task state into the DB. | shared |
| `lore_ready_tasks` | [spec](ready-tasks/spec.md) | List tasks ready to run. | shared |
| `lore_claim_task` | [spec](claim-task/spec.md) | Atomically claim a task. | shared |
| `lore_complete_task` | [spec](complete-task/spec.md) | Mark a task complete. | shared |
| `lore_list_pending_tasks` | [spec](list-pending-tasks/spec.md) | List pending local-runner tasks. | shared |
| `lore_skip_task` | [spec](skip-task/spec.md) | Skip a pending task. | shared |
| `lore_enable_task_notifications` | [spec](enable-task-notifications/spec.md) | Start the local task notifier. | shared |
| `lore_disable_task_notifications` | [spec](disable-task-notifications/spec.md) | Stop the local task notifier. | shared |

## Repo (`repo-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_list_repos` | [spec](list-repos/spec.md) | List onboarded repos + counts. | shared |
| `lore_onboard_repo` | [spec](onboard-repo/spec.md) | Onboard a repo (opens a PR). | shared |
| `lore_ingest_files` | [spec](ingest-files/spec.md) | Proxy file ingest to the API. | shared |

## Spec-trace (`spec-trace-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| ~~`lore_ingest_graph`~~ | [spec](ingest-graph/spec.md) | **Removed** — spec-traceability projection is CI-driven (ADR-023); no ingest task. | — |

## Usage (`usage-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_my_usage` | [spec](my-usage/spec.md) | Per-developer token usage. | shared |
| `lore_get_analytics` | [spec](get-analytics/spec.md) | Aggregate usage analytics. | shared |

## Local-only (`*.local.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_list_tests` | [spec](list-tests/spec.md) | Enumerate the repo's tests (manifest). | local |
| `lore_run_test` | [spec](run-test/spec.md) | Run one test with coverage. | local |
| `lore_run_task_locally` | [spec](run-task-locally/spec.md) | Run a task in a local worktree. | local |
| `lore_list_local_tasks` | [spec](list-local-tasks/spec.md) | List local runner tasks. | local |
| `lore_cancel_local_task` | [spec](cancel-local-task/spec.md) | Cancel a local task. | local |
| `lore_claim_and_run_locally` | [spec](claim-and-run-locally/spec.md) | Claim a pending task + run it locally. | local |
| `lore_configure_local_runner` | [spec](configure-local-runner/spec.md) | Read/update local runner config. | local |
