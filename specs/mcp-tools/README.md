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

## Context (`context-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `assemble_context` | [spec](assemble-context/spec.md) | Assemble token-budgeted context from all sources for turn 1. | shared |
| `search_context` | [spec](search-context/spec.md) | Keyword/passage search over ingested `.md` context. | shared |

## Memory (`memory-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `write_memory` | [spec](write-memory/spec.md) | Store a key/value memory (with versioning). | shared |
| `read_memory` | [spec](read-memory/spec.md) | Retrieve a memory by key (+ version history). | shared |
| `delete_memory` | [spec](delete-memory/spec.md) | Soft-delete a memory. | shared |
| `list_memories` | [spec](list-memories/spec.md) | Paginated listing of active memories. | shared |
| `search_memory` | [spec](search-memory/spec.md) | Semantic search across memories + facts. | shared |
| `write_episode` | [spec](write-episode/spec.md) | Ingest raw text; extract facts + graph. | shared |
| `query_graph` | [spec](query-graph/spec.md) | Query the live knowledge graph. | shared |
| `agent_stats` | [spec](agent-stats/spec.md) | Agent health + memory/episode/fact counts. | shared |

## Pipeline (`pipeline-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `create_pipeline_task` | [spec](create-pipeline-task/spec.md) | Create a pipeline task. | shared |
| `get_pipeline_status` | [spec](get-pipeline-status/spec.md) | Get one task's status. | shared |
| `list_pipeline_tasks` | [spec](list-pipeline-tasks/spec.md) | List pipeline tasks. | shared |
| `cancel_task` | [spec](cancel-task/spec.md) | Cancel a task. | shared |
| `retry_task` | [spec](retry-task/spec.md) | Retry a failed task. | shared |
| `list_task_group` | [spec](list-task-group/spec.md) | List tasks in a multi-repo group. | shared |
| `get_pr_status` | [spec](get-pr-status/spec.md) | Computed PR status for a task. | shared |
| `get_task_logs` | [spec](get-task-logs/spec.md) | Read a task's logs from GCS. | shared |
| `get_job_logs` | [spec](get-job-logs/spec.md) | Read a job run's logs from GCS. | shared |
| `sync_tasks` | [spec](sync-tasks/spec.md) | Sync task state into the DB. | shared |
| `ready_tasks` | [spec](ready-tasks/spec.md) | List tasks ready to run. | shared |
| `claim_task` | [spec](claim-task/spec.md) | Atomically claim a task. | shared |
| `complete_task` | [spec](complete-task/spec.md) | Mark a task complete. | shared |
| `list_pending_tasks` | [spec](list-pending-tasks/spec.md) | List pending local-runner tasks. | shared |
| `skip_task` | [spec](skip-task/spec.md) | Skip a pending task. | shared |
| `enable_task_notifications` | [spec](enable-task-notifications/spec.md) | Start the local task notifier. | shared |
| `disable_task_notifications` | [spec](disable-task-notifications/spec.md) | Stop the local task notifier. | shared |

## Repo (`repo-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `list_repos` | [spec](list-repos/spec.md) | List onboarded repos + counts. | shared |
| `onboard_repo` | [spec](onboard-repo/spec.md) | Onboard a repo (opens a PR). | shared |
| `ingest_files` | [spec](ingest-files/spec.md) | Proxy file ingest to the API. | shared |

## Spec-trace (`spec-trace-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `ingest_graph` | [spec](ingest-graph/spec.md) | Create spec-traceability ingest tasks. | shared |

## Usage (`usage-tools.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `my_usage` | [spec](my-usage/spec.md) | Per-developer token usage. | shared |
| `get_analytics` | [spec](get-analytics/spec.md) | Aggregate usage analytics. | shared |

## Local-only (`*.local.ts`)
| Tool | Spec | Purpose | Scope |
|------|------|---------|-------|
| `list_tests` | [spec](list-tests/spec.md) | Enumerate the repo's tests (manifest). | local |
| `run_test` | [spec](run-test/spec.md) | Run one test with coverage. | local |
| `run_task_locally` | [spec](run-task-locally/spec.md) | Run a task in a local worktree. | local |
| `list_local_tasks` | [spec](list-local-tasks/spec.md) | List local runner tasks. | local |
| `cancel_local_task` | [spec](cancel-local-task/spec.md) | Cancel a local task. | local |
| `claim_and_run_locally` | [spec](claim-and-run-locally/spec.md) | Claim a pending task + run it locally. | local |
| `configure_local_runner` | [spec](configure-local-runner/spec.md) | Read/update local runner config. | local |
