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
  param name, each field `.describe(...)`d. One tool per file
  (`<domain>/<tool>.ts` exports `register<Tool>Tool(server)`); the domain's `index.ts` registers its tools in a fixed order. ([validated by registers the domain's tools in order @8b744b0f](apps/mcp-server/src/transport/tools/ci/index.test.ts#L6), [validated by registers lore_search_context before lore_assemble_context @c72945a7](apps/mcp-server/src/transport/tools/context/index.test.ts#L6), [validated by registers lore_write_episode, lore_query_graph and lore_agent_stats in that order @ac26e4dd](apps/mcp-server/src/transport/tools/graph/index.test.ts#L6), [validated by registers the five memory tools, then the graph and episode tools, in that order @e5e3da19](apps/mcp-server/src/transport/tools/memory/index.test.ts#L6), [validated by registers the seven pipeline tools in their fixed order @cf3a563b](apps/mcp-server/src/transport/tools/pipeline/index.test.ts#L13), [validated by registers lore_plan_read before lore_plan_edit @c45c3bd5](apps/mcp-server/src/transport/tools/plan/index.test.ts#L5), [validated by registers the domain's tools in order @8b744b0f](apps/mcp-server/src/transport/tools/repo/index.test.ts#L6), [validated by registers the domain's tools in order @8b744b0f](apps/mcp-server/src/transport/tools/spec-trace/index.local.test.ts#L6), [validated by registers the domain's tools in order @8b744b0f](apps/mcp-server/src/transport/tools/spec-trace/index.test.ts#L6), [validated by registers lore_update @e03d3758](apps/mcp-server/src/transport/tools/update/index.test.ts#L6), [validated by registers lore_my_usage before lore_get_analytics @637cd266](apps/mcp-server/src/transport/tools/usage/index.test.ts#L5))
- **Return envelope**: every handler returns `{ content: [{ type: "text" as const, text }] }`.
  Handlers **never throw** — they catch and return the error as text. (Several wrap
  the body in `trackLatency(name, …)`, which records latency to `memory.audit_log`.) ([validated by returns the result 42 and records a successful call of lore_test_ok @c4cfca8b](apps/mcp-server/src/transport/tools/shared/deps.test.ts#L10), [validated by rethrows the error and records a failed call of lore_test_fail @111938ea](apps/mcp-server/src/transport/tools/shared/deps.test.ts#L19))
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

## Context (`context/`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_assemble_context` | [spec](assemble-context/spec.md) | Assemble token-budgeted context from all sources for turn 1. | shared |
| `lore_search_context` | [spec](search-context/spec.md) | Keyword/passage search over ingested `.md` context. | shared |

## Memory (`memory/`, `graph/`)
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

## Pipeline (`pipeline/`, `ci/`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| ~~`lore_create_pipeline_task`~~ | [spec](create-pipeline-task/spec.md) | Removed 2026-10-02: the API creates no task from a description. | — |
| `lore_get_pipeline_status` | [spec](get-pipeline-status/spec.md) | Get one task's status. | shared |
| `lore_list_pipeline_tasks` | [spec](list-pipeline-tasks/spec.md) | List pipeline tasks. | shared |
| `lore_cancel_task` | [spec](cancel-task/spec.md) | Cancel a task. | shared |
| `lore_retry_task` | [spec](retry-task/spec.md) | Retry a failed task. | shared |
| `lore_list_task_group` | [spec](list-task-group/spec.md) | List tasks in a multi-repo group. | shared |
| `lore_get_pr_status` | [spec](get-pr-status/spec.md) | Computed PR status for a task. | shared |
| `lore_get_ci_failures` | [spec](get-ci-failures/spec.md) | What CI said about a branch: judged sha, verdict, each failed check explained. | shared |
| `lore_get_ci_job_log` | [spec](get-ci-job-log/spec.md) | The tail of one Actions job's log, filtered. | shared |
| `lore_get_task_logs` | [spec](get-task-logs/spec.md) | Read a task's execution transcript. | shared |
| `lore_get_job_logs` | [spec](get-job-logs/spec.md) | Read a job run's logs from GCS. | shared |

## Repo (`repo/`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_list_repos` | [spec](list-repos/spec.md) | List onboarded repos + counts. | shared |
| `lore_onboard_repo` | [spec](onboard-repo/spec.md) | Onboard a repo (opens a PR). | shared |
| `lore_ingest_files` | [spec](ingest-files/spec.md) | Proxy file ingest to the API. | shared |

## Spec-trace (`spec-trace/`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| ~~`lore_ingest_graph`~~ | `spec` | **Removed** — spec-traceability projection is CI-driven (ADR-023); no ingest task. | — |

## Usage (`usage/`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_my_usage` | [spec](my-usage/spec.md) | Per-developer token usage. | shared |
| `lore_get_analytics` | [spec](get-analytics/spec.md) | Aggregate usage analytics. | shared |

## Local-only (`*.local.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `lore_list_tests` | [spec](list-tests/spec.md) | Enumerate the repo's tests (manifest). | local |
| `lore_run_test` | [spec](run-test/spec.md) | Run one test with coverage. | local |
