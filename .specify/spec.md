# System Specification: Lore

| Feature | Lore                                   |
| ------- | -------------------------------------- |
| Status  | Shipped                                |
| Created | 2026-10-05                             |
| Owner   | re-cinq                                |

Lore is shared context infrastructure for Claude Code: it gives every developer and background agent instant org awareness — conventions, ADRs, team patterns, PR history, agent memory, and current task state — without any manual context loading, and runs an agent operating system that onboards repos, detects spec drift, and reviews pull requests autonomously.

## Overview

Lore is a two-deployable platform sharing a common TypeScript core:

- **`apps/mcp-server`** — the local stdio MCP adapter that runs on each developer's laptop and proxies all data operations to the remote Lore API. Also deployed as the `lore-mcp` HTTP gateway on GKE for agent pods, and serves the agent-skills registry.
- **`apps/lore-api`** — the remote HTTPS REST backend on GKE. Owns hybrid search, agent memory, task CRUD, ingest, and the GitHub webhook door.
- **`apps/stations`** — service stations for deterministic pipeline steps; also the scheduler, emitting and draining `cron.*.tick` events.
- **`apps/web-ui`** — Next.js dashboard. Reads everything through lore-api; holds no database pool.
- **`apps/lore-code-trace`** — Go binary that runs the project test suite and posts coverage to the spec-traceability graph.

Five workloads ship as one `lore-platform` umbrella Helm chart on GKE. The assembly-line engine is the external floor ([re-cinq/floor](https://github.com/re-cinq/floor)), reached only through `@re-cinq/floor-client`.

## Key Capabilities

### Context assembly
`lore_assemble_context` delivers a single token-budgeted bundle of conventions, ADRs, memories, facts, and graph relationships in one MCP call. Hybrid search (pgvector HNSW + BM25 GIN, Reciprocal Rank Fusion) powers `lore_search_context` and `lore_search_memory`.

### Agent memory
Persistent, temporal, org-shared memory stored in PostgreSQL (`memory` schema). Facts carry confidence tiers (`verified / observed / inferred / stale`), validity windows, and half-life decay. Episodes (raw text) are auto-curated into facts and knowledge-graph entities via Haiku. Conflict detection invalidates superseded facts.

### Task pipeline
Work enters as a GitHub issue with a `priority:*` label; the implementation loop (floor pipeline `implementation-loop.yaml`) picks it up and runs an agent pod. Plans decompose features into spec-tasks that run on the same loop. Code-review runs automatically on every PR where `auto_review` is on.

### Spec-traceability graph
CI-driven, zero-LLM. `lore-ingest.yml` projects CLAUDE.md / ADRs / specs into the graph on every push to main. `lore-tests.yml` runs the project test suite via `lore-code-trace` and posts per-test coverage to `POST /api/repos/:o/:r/ingest`, binding tests to spec statements through inline `([validated by](path#Lnn))` links authored in `spec.md` files.

### Repo onboarding
The `onboard` floor pipeline (`libs/assembly-lines/src/floor-pipelines/onboard.yaml`) creates a single PR on the target repo with CLAUDE.md, AGENTS.md, PR template, CI workflows, ADRs, and a spec, then waits for CI and requests review.

## Core Data Model

| Entity | Storage | Description |
|---|---|---|
| `lore.repos` | PostgreSQL | Onboarded repositories; settings, trust tier, ingest state |
| `lore.agent_definitions` | PostgreSQL | Per-task-type agent config (prompt, model, timeout, image); org defaults seeded from `libs/shared/src/agent-defaults/` |
| `pipeline.tasks` | PostgreSQL | Work items; claimed by the floor, keyed on type + repo |
| `pipeline.assembly_runs` | PostgreSQL | One floor run per task attempt |
| `pipeline.events` | PostgreSQL | Event bus rows; consumed by the stations drain |
| `memory.memories` | PostgreSQL | Key-value memories with TTL, confidence, half-life |
| `memory.facts` | PostgreSQL | Auto-extracted facts; temporal validity, conflict tracking |
| `memory.entities` + `memory.edges` | PostgreSQL | Live knowledge graph |
| `{schema}.chunks` | PostgreSQL + pgvector | Embedded document chunks per team (768-d, Vertex AI) |
| Spec-traceability graph | Dgraph | Spec statements → test coverage links; `COVERS` / `validated_by` edges |

## User Roles

| Role | How they use Lore |
|---|---|
| **Developer** | `install.sh` once; Claude Code then auto-loads org context via MCP on every session. Uses `/lore-feature`, `/lore-pr`, `/lore-help` skills. |
| **Product Manager** | Creates feature plans in the web UI; the planning agent writes the spec collaboratively. Approves the plan to kick off spec-tasks on the implementation loop. |
| **Platform Engineer** | Onboards repos, tunes `auto_review` and trust tier settings, monitors the pipeline, manages GKE deployment via `terraform apply`. |
| **Agent (background)** | Runs in a pod on the external floor with a live scoped MCP connection to the `lore-mcp` HTTP gateway. Reads context, writes memory, edits code, and opens PRs. |

## Business Rules

1. **Context-first workflow**: every Claude Code session must call `lore_assemble_context` before planning or building, then `lore_search_memory` to surface prior learnings.
2. **Work enters through the backlog**: there is no create-task-from-description path. An issue with a `priority:*` label (or a plan's spec-task) is the only entry point for the implementation loop.
3. **Spec status upkeep**: when a branch implements a spec, its `| Status |` row must be updated (Draft → Implemented/Shipped) in the same branch. The merge-check opens a deterministic PR to do this when all spec-tasks in a group are merged.
4. **Commit trailers on Lore-managed branches**: every Lore-authored commit carries `Lore-Stage`, `Lore-Iteration`, and `Lore-Task` trailers (audit substrate). No `--amend`, fixup, force-push, or rebase on branches carrying trailers.
5. **No secrets in Terraform variables**: secret rotation is `gcloud secrets versions add`; Terraform declares containers only, ESO mirrors them into Kubernetes.
6. **Progressive trust**: repos advance through `docs → tests → implementation → full` trust tiers, auto-promoting after three successful merges. `onboard` is allowed at every tier.
7. **Privacy filtering**: all memory writes pass through `sanitizeContent()` / `redactSecrets()` before storage.
8. **Module import boundaries**: `lore/no-sql-in-web-ui` ESLint rule enforces that web-ui holds no database pool. Cross-package boundaries are declared in `layers.yaml`.

## Success Metrics

- **Context found-and-answered rate**: ≥ 85% of sampled ADRs and specs are found and answered by context assembly per onboarded repo (enforced nightly by `context-evals.yml`).
- **Spec-traceability coverage**: spec statements have test links that survive the weekly `spec-upkeep` line.
- **Implementation loop merge rate**: percentage of loop runs that produce a merged PR without human re-work.
- **Task-to-merge latency**: median wall-clock time from task creation to merged PR per trust tier.
- **Memory retrieval latency**: `lore_assemble_context` p99 under 3 s at steady state.
- **CI green rate**: `lore-tests.yml` and `lore-ingest.yml` pass rate on the main branch (tracked via Lore's own spec-traceability graph and dashboard).
