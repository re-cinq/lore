# Lore — System Specification

| Status | Implemented |
|---|---|
| Owner | re-cinq |
| Last Updated | 2026-10-07 |

## Overview

Lore is shared context infrastructure for Claude Code. It makes AI coding assistants organization-aware by giving them access to conventions, architectural decisions, team patterns, PR history, and task state — without any manual context loading per session.

Beyond context, Lore is an **agent operating system**: it runs background agents that onboard repositories, detect documentation drift, review pull requests, and implement features from a backlog — all producing pull requests that humans review and merge.

The system has two deployment modes. For developers, a lightweight local MCP adapter runs on each laptop and proxies all operations to the shared cloud backend. For agents, the same MCP adapter runs as an HTTP gateway on GKE, giving agent pods live, scoped Lore access for the duration of a run.

## Key Capabilities

### Context Loading

- `lore_assemble_context` — one-call, token-budgeted bundle of org conventions, ADRs, memory, facts, and graph relationships relevant to the current task
- `lore_search_context` — hybrid vector + BM25 (Reciprocal Rank Fusion) search across ingested repo content
- `lore_search_memory` — semantic search across agent memories and extracted facts
- `lore_query_graph` — live knowledge graph for entity and relationship queries
- Cross-repo context via `settings.cross_repo_repos` (bidirectional, filtered by transfer score)
- Stale context warnings when ingestion is > 7 days old

### Agent Memory

- Persistent key-value memories with optional TTL (`lore_write_memory`, `lore_read_memory`)
- Episode ingestion for passive fact extraction from conversation turns and observations (`lore_write_episode`)
- Temporal facts with confidence tiers (`verified`, `observed`, `inferred`, `stale`) and half-life decay
- Knowledge graph with entities and edges updated on every episode write
- Automatic conflict detection when new facts contradict stored ones (cosine similarity ≥ 0.92)
- Memory shared across all agents in the org

### Task Pipeline

- Tasks originate from repository backlog issues (priority-labelled GitHub Issues) or approved plans
- The implementation loop runs on the external floor ([re-cinq/floor](https://github.com/re-cinq/floor)), one run per ticket
- Plans are edited collaboratively in the web UI and run spec-tasks on the same loop
- `lore_run_task_locally` runs a task in a local git worktree (tracked on laptop only)

### Autonomous Agents

- **Code review** — every open PR reviewed by the `code-review` floor pipeline when `auto_review` is enabled; request-for-changes answered by `code-review-reply`
- **Onboarding** — `onboard` pipeline adds AGENTS.md, ADRs, spec, PR template, and CI workflows to a target repository in one PR
- **Spec upkeep** — weekly `spec-upkeep` pipeline fixes spec drift and adds test trace links
- **Implementation loop** — `implementation-loop` pipeline implements backlog tickets: DoD → open PR → TDD rounds → await CI → request review

### Spec-Traceability Graph

- Specs link to tests inline: `Statement. ([validated by name](path/to/test.ts#L42))`
- The `lore-code-trace` binary runs the test suite in CI, collects per-test coverage, and POSTs the traceability report to Lore
- `lore-ingest.yml` ingests specs and ADRs on every push to main
- Web UI shows per-statement coverage, confidence, and validation status

### Web UI

- Next.js dashboard (`apps/web-ui`) — holds no database pool; reads through lore-api
- Live assembly run visualization via one WebSocket per browser tab (`/api/ws`)
- Per-repo: specs list, ADRs, run list, agents config, settings
- Global: cross-repo spec browser, run list, agent definitions

## Core Data Model

### Repositories (`lore.repos`)

The unit of onboarding. Each repo has settings (trust level, auto-review, slack channel, cross-repo links), an optional onboarding PR URL, and test command manifest (`settings.test_commands` or `.lore/test-commands.yml`).

Trust levels: `docs` → `tests` → `implementation` → `full`. Auto-promotes after three successful merges at the current level.

### Pipeline Tasks (`pipeline.tasks`)

A task represents one unit of agent work. It carries: type, status, repo, optional `task_group_id` for multi-repo coordination, `context_refs` for PR outcome feedback, and a `spec_path` for spec-task runs.

Statuses: `pending` → `running` → `complete` | `failed` | `cancelled`.

Task types in production: `onboard`, `code-review`, `code-review-reply`, `code-review-recheck`, `feature-planning`, `implementation-loop`, `spec-upkeep`, `lore-run-settled`.

### Agent Memory (`memory` schema)

`memories` — key-value blobs with TTL, retrieval count, half-life decay  
`facts` — extracted atomic claims with `valid_from`/`valid_to`, confidence, embeddings  
`episodes` — raw text ingested for passive fact + entity extraction  
`entities` + `edges` — live knowledge graph  
`fact_conflicts` — contradiction records

### Events (`pipeline.events` + `pipeline.event_deliveries`)

Events are written by lore-api (GitHub webhooks → `github.*`) and by stations (cron ticks → `cron.*.tick`). The stations service drains its own subscription with `FOR UPDATE SKIP LOCKED`, dispatches by `event_name`, retries with backoff, and dead-letters stuck deliveries.

### Assembly Runs

`pipeline.assembly_runs` and `pipeline.station_runs` — historical runs from Lore's own Floor, kept as read-only history. Runs on the external floor live in the floor and are read through `@re-cinq/floor-client`.

## User Roles

| Role | Interface | Primary actions |
|---|---|---|
| Developer | Claude Code (MCP) | Context loading, memory, local task runner, PR description, feature planning |
| Developer | Web UI | Spec browser, run list, agent config |
| Product Manager | Claude Code (`/lore-feature`) | Feature specs → plan → backlog tickets |
| Platform Engineer | Web UI + CLI | Repo onboarding, settings, analytics, agent definitions |
| Agent (code-review) | MCP gateway (HTTP) | PR review, reply to changes requests |
| Agent (implementation) | MCP gateway (HTTP) | Read context, write memory, edit code, open PRs |

## Business Rules

- **No task from description**: tasks reach agents only from labelled backlog issues, approved plan spec-tasks, or `lore_run_task_locally` (laptop only). `POST /api/task` only acts on existing tasks.
- **Context first**: every agent run starts with `lore_assemble_context`; there is no dispatch-time hydration.
- **Audit substrate**: every Lore-authored commit carries `Lore-Stage`, `Lore-Iteration`, and `Lore-Task` trailers; every PR body carries `Lore-Task: <uuid>`.
- **No long-lived credentials**: Workload Identity on GKE; secrets via External Secrets Operator from GCP Secret Manager; no secret values in Terraform.
- **Deterministic validation**: after agent edits, lint and typecheck run as mandatory pipeline stages scoped to changed files.
- **Privacy**: all memory writes pass through `sanitizeContent()` / `redactSecrets()` before storage.
- **Two-key ceremony**: writing an `image` override on an agent definition requires admin scope plus a CODEOWNER-approved PR.
- **Trust gating**: each repo's `settings.trust.level` controls which task types are allowed.

## Architecture

### Deployables (one umbrella Helm chart `lore-platform`)

| Service | Namespace | Responsibility |
|---|---|---|
| `apps/lore-api` | `lore-api` | REST backend, hybrid search, memory, task CRUD, GitHub webhook ingress |
| `apps/stations` | `lore-stations` | Event bus drain, cron scheduler, Lore's floor stations |
| `apps/mcp-server` | `lore-api` | MCP adapter (stdio on laptops, HTTP gateway on GKE for agent pods) |
| `apps/web-ui` | `lore-ui` | Next.js dashboard; also runs SQL migrations on deploy |
| `charts/lore-db-helm` | `lore-db` | PostgreSQL + pgvector via CloudNativePG |

Assembly-line execution runs on the **external floor** ([re-cinq/floor](https://github.com/re-cinq/floor)), deployed separately. Lore's own Floor (`apps/floor`) was removed on 2026-10-02.

### Key Libraries

- `libs/shared` (`@re-cinq/lore-shared`) — domain models, outbound adapters, business logic shared across all apps
- `libs/server-core` (`@re-cinq/lore-server-core`) — context assembly, memory, YAML templates; used by lore-api and mcp-server
- `libs/assembly-lines` (`@re-cinq/lore-assembly-lines`) — floor pipeline YAML files and shared station utilities

### Storage

- PostgreSQL + pgvector (CloudNativePG on GKE): schema-per-team isolation, HNSW vector indexes, GIN BM25 keyword indexes
- Dgraph: spec-traceability graph (deployed from Terraform alongside the umbrella)
- Hybrid search via Reciprocal Rank Fusion (vector + BM25)
- Embeddings: Vertex AI `text-embedding-005` (768 dimensions), via vendor-neutral `EmbeddingProvider`

### Tech Stack

- **TypeScript** — MCP server, lore-api, stations, web-ui (ESM, strict, ES2023, Zod validation)
- **Go** — `apps/lore-code-trace` (test orchestrator binary)
- **Next.js 15** — web-ui (App Router, no DB pool)
- **Python** — glue scripts (lore-gen-constitution, < 100 lines each)
- **Bash** — install.sh, lore-doctor, infra scripts (idempotent, prefix `[lore]`)
- **Helm + Terraform** — GKE deployment, one umbrella chart

## Success Metrics

- **Context recall**: ≥ 85% of sampled ADRs and specs found-and-answered in nightly context evals (the `context-evals.yml` CI job fails a repo under this threshold)
- **Spec traceability**: every testable statement linked to a test file and covered by CI
- **Task throughput**: implementation-loop PRs opened, reviewed, and merged without manual intervention
- **Memory health**: fact confidence distribution, half-life decay rates, consolidation coverage
- **Pipeline reliability**: zero-downtime deploys via `helm upgrade --wait` + pre-install migrations hook
