# Lore — System Specification

| Field | Value |
|---|---|
| Status | Implemented |
| Version | 1.0 |
| Date | 2026-10-05 |

## Overview

Lore is a shared context infrastructure platform for Claude Code that makes AI agents organisation-aware. It collects knowledge from repositories, developer sessions, and agent activity; stores it in a PostgreSQL + pgvector database; and serves it on demand to Claude Code sessions and background agents via the Model Context Protocol (MCP).

Beyond context delivery, Lore is an **agent operating system**. It runs background agents on an external floor runtime that onboard repositories, detect documentation gaps, fix spec drift, review pull requests, and implement backlog tickets — all producing pull requests that humans review and merge.

## Key Capabilities

### 1. Organisation-Wide Context Assembly
- Ingests repository files (CLAUDE.md, ADRs, runbooks, specs, code) by chunking and embedding them into a PostgreSQL + pgvector store with schema-per-team isolation.
- Assembles a token-budgeted context bundle (`lore_assemble_context`) combining chunks, memories, facts, and knowledge-graph relationships in a single MCP tool call.
- Supports hybrid search (vector + BM25 via Reciprocal Rank Fusion) for both context and memory retrieval.
- Warns when repo context is stale (> 7 days) and flags cross-repo context with a transfer score to avoid leaking repo-specific configuration.

### 2. Agent Memory
- Stores typed memories with temporal validity and confidence tiers (verified / observed / inferred / stale).
- Passively captures tool calls via a session tracker; dumps them to `~/.lore/last-session.json` and POSTs an episode summary on session exit.
- Extracts structured facts and knowledge-graph entities from raw episode text using a configurable LLM.
- Implements importance-based decay, retrieval strengthening, daily consolidation, and conflict detection (cosine similarity ≥ 0.92).

### 3. Task Pipeline
- Tracks work as pipeline tasks tied to GitHub Issues on the target repository.
- Runs tasks as AssemblyLine executions on the external floor runtime (re-cinq/floor); Lore's own floor engine was removed on 2026-10-02.
- Supports the implementation loop (backlog ticket → TDD round → CI → PR → review), spec-task execution, feature planning (collaborative plan editor backed by Hocuspocus), spec-upkeep (drift detection + link addition), and autonomous code review.
- Provides local task runner support (worktrees + background Claude Code, laptop only).

### 4. Autonomous Code Review
- Every open pull request on repos with `auto_review` enabled is reviewed by the `code-review` assembly line.
- A request for changes from a trusted reviewer triggers the `code-review-reply` line.
- Review results are posted as PR comments; the review station is a Lore floor station.

### 5. Spec Traceability
- Maintains a traceability graph linking spec statements to test functions via inline markdown anchors.
- The `lore-code-trace` Go binary runs the repo's test suite in CI, collects per-test coverage, and POSTs the delta to lore-api.
- Spec drift and missing test links are fixed weekly by the `spec-upkeep` assembly line on the external floor.

### 6. Repository Onboarding
- Onboards a repository via UI or MCP tool; creates a PR with CLAUDE.md, AGENTS.md, PR template, and CI workflows.
- After merge, nightly ingestion indexes the repo's content.
- Onboarding runs as the `onboard` assembly line on the external floor.

### 7. Web UI
- A Next.js dashboard at the `lore-ui` namespace provides: per-repo spec browser, live assembly-run visualiser (DAG + transcript), plans editor, agent-definitions manager, repo settings, and cross-repo spec search.
- Holds no database pool; all data flows through lore-api REST routes.
- Live data arrives over a single WebSocket per browser tab (ADR-048).

## Core Data Model

### PostgreSQL schemas

| Schema | Purpose |
|---|---|
| `lore` | Platform tables: `repos`, `schema_migrations`, `api_tokens`, `plans`, `plan_state`, `plan_versions`, `live_tokens`, `agent_definitions` |
| `pipeline` | Task pipeline: `tasks`, `assembly_runs`, `station_runs`, `agent_run_events`, `agent_run_turns`, `events`, `event_deliveries`, `api_tokens`, `audit_log`, `leases` |
| `memory` | Agent memory: `memories`, `memory_versions`, `facts`, `fact_conflicts`, `episodes`, `entities`, `edges`, `snapshots`, `shared_pools`, `audit_log` |
| Per-team schema | Chunk storage: `chunks` (content + 768-d embeddings), HNSW + GIN indexes |

### Key entities

- **Repo** — an onboarded GitHub repository; carries `settings` JSONB (trust level, auto_review, Slack channel, cross-repo links, etc.).
- **Task** — a unit of agent work tied to a GitHub Issue; has a type, status, and `task_group_id` for multi-repo coordination.
- **AssemblyRun** — one execution of an AssemblyLine; cloned at start from the blueprint so in-flight edits cannot change the graph.
- **Memory / Fact** — persistent agent learnings with temporal validity and confidence tiers.
- **Episode** — raw text blob (conversation turn, session dump, PR outcome) from which facts and graph entities are extracted.
- **Plan** — a collaborative feature specification hosted by lore-api; edited by humans and the planning agent concurrently via Hocuspocus.

## User Roles

| Role | Primary interface | Capabilities |
|---|---|---|
| **Developer** | Claude Code + MCP tools | Load org context, search memory, run tasks locally, query the knowledge graph, file backlog tickets |
| **Product Manager** | Claude Code + `/lore-feature` skill | Author specs and plans; the planning agent turns them into task issues |
| **Platform Engineer** | Web UI + Terraform | Onboard repos, configure settings, deploy the platform, manage secrets and agent definitions |
| **Agent (Claude)** | MCP gateway (HTTP, in pod) | Assemble context, read/write memory, execute pipeline tasks, call CI tools |
| **Reviewer** | GitHub pull request UI | Approve agent PRs; a request-for-changes from a trusted reviewer triggers the reply line |

## Business Rules

1. **Context-first**: every Claude Code session MUST call `lore_assemble_context` as its first action before reading files or planning.
2. **No source-code writes by lore-api**: lore-api is a REST backend only; code changes happen inside agent pods on the external floor.
3. **Task types are constrained**: `implementation` and `general` task types are retired; work enters the pipeline as backlog issues with `priority:*` labels or as plan spec-tasks.
4. **Spec status upkeep**: when a branch implements a feature, its `spec.md` `| Status |` row must be updated in the same branch.
5. **No long-lived credentials**: Workload Identity on GKE; `gcloud auth` for local dev; secret material never a Terraform input.
6. **Soft-fail on Lore outage**: CI workflows that post to Lore must not fail the repo's own CI when Lore is unreachable.
7. **No auto-merge**: merges are made by humans or by the `merge` assembly line for a PR a human has already merged.
8. **Two-key for agent image overrides**: changing an agent definition's `image` field requires a CODEOWNER-approved PR labeled `dark-factory-approval`.
9. **Privacy filtering**: all memory writes pass through `sanitizeContent()` / `redactSecrets()` before storage.
10. **Idempotent ingest**: spec, ADR, and test ingest use xid upserts; re-running on the same commit is a no-op.

## Success Metrics

- **Context hit rate**: ≥ 85 % of ingested ADRs and specs found and answered by `POST /api/context-evals` (enforced nightly by `.github/workflows/context-evals.yml`).
- **Spec coverage**: every testable spec statement has an inline test link; uncovered statements are flagged by the weekly `spec-upkeep` floor run.
- **Onboarding lead time**: a new repo receives a merged onboarding PR (CLAUDE.md, AGENTS.md, CI workflows) within one floor run of the onboard request.
- **Review latency**: an open PR on an `auto_review` repo receives a code-review comment within the floor's SLA for a `code-review` line run.
- **Memory freshness**: context assembly warns when last ingest is > 7 days; the nightly context-evals job fails a repo below the 85 % threshold.
- **Pipeline reliability**: soft-fail wrappers on Lore CI steps ensure Lore outages never redden a repo's own CI.
