# Lore System Specification

## Overview

Lore is a shared context infrastructure platform that makes Claude Code organization-aware. It enables developers to access org-wide conventions, team-specific patterns, architectural decisions, and current task state automatically—without manual context loading. Beyond context delivery, Lore functions as an **agent operating system** that runs background autonomous agents for repository onboarding, documentation gap detection, specification drift checking, and PR review, all producing pull requests for human review and merge.

**Status:** Production (GKE-deployed)  
**Primary Users:** Developers, product managers, platform engineers  
**Core Technology Stack:** TypeScript (MCP server), Python (glue scripts), Bash (install/infra), PostgreSQL + pgvector (vector store), Kubernetes (cluster runtime), Anthropic Claude API (agent execution)

## Key Capabilities

### Context Delivery
- **lore_assemble_context** — Single-call, token-budgeted retrieval of org conventions, ADRs, team patterns, PR history, and task state
- **lore_search_context** — Hybrid search (vector + BM25 via Reciprocal Rank Fusion) across repo documentation, code patterns, and structured knowledge
- **lore_search_memory** — Semantic search across persistent agent memories, facts, and episodes with confidence annotations
- **lore_query_graph** — Query live knowledge graph for entities and relationships

### Agent Memory & Knowledge
- **lore_write_memory** — Store persistent key-value memories with optional TTL
- **lore_read_memory** — Retrieve memories with version history
- **lore_write_episode** — Ingest unstructured text (conversations, observations); auto-extracts facts and updates knowledge graph
- **lore_agent_stats** — Health metrics, memory count, episode count, facts, searches, daily breakdown
- Auto-curated facts with temporal validity, confidence tiers (verified/observed/inferred/stale), and retrieval strengthening
- Knowledge graph with entities and relationships extracted from episodes
- Automatic consolidation of recent facts into higher-level patterns
- Importance-based memory decay with half-life model; eviction when count exceeds 500

### Task Pipeline & Execution
- **lore_create_pipeline_task** — Delegate work to cluster agents with context pre-loading
- **lore_get_pipeline_status** — Poll task completion
- **lore_list_pipeline_tasks** — Browse available and in-progress work
- **lore_run_task_locally** — Execute tasks in local worktrees with background Claude Code
- Task types: feature-request, onboard, general, runbook, implementation, gap-fill, review
- Per-repo task-type overrides (model, timeout, system prompt, review requirement)
- Task groups for coordinating multi-repo features
- Progressive trust levels (docs → tests → implementation → full) with auto-promotion after 3 successful merges

### Repository Onboarding
- Auto-generate CLAUDE.md, AGENTS.md, ADRs, specs, and CI workflows
- Schema-per-team isolation in PostgreSQL
- Automatic nightly ingestion of repo content
- Deterministic validation pipeline (lint/typecheck) post-implementation
- Test-interface support for language-neutral test discovery and coverage tracking

### Autonomous Review Loop
- Opt-in per-repo auto-review mode
- Review Job pod reads spec + conventions, posts PR comments
- Feedback iteration (up to 2 rounds); escalation to human after 2 iterations
- Webhook-driven review reactor for post-PR feedback processing
- Business-hours safety cron gate (Europe/Berlin 9-18, Mon-Fri; configurable)

### Dark Factory Mode (Opt-In)
- Per-repo autonomous workflow with minimal Issue creation
- Two-gate enablement (repo setting + cluster env var) for safety
- Two-key authorization for privileged changes (admin scope + CODEOWNERS approval)
- Branch-as-state via commit trailers (Lore-Stage, Lore-Iteration, Lore-Task)
- Workflow definitions as YAML (declarative, composable, resumable)
- Auto-merge after [stage:retrospective] with path-based safety gates
- Audit log tracking of all decisions (auto-merge rules, escalations, notifications)

### Developer Tools
- `/lore-feature` — End-to-end feature creation (spec → tasks → implementation)
- `/lore-pr` — Draft PR descriptions from spec + conventions
- `lore-doctor` — Health check script
- `lore_my_usage` — Per-developer token usage (today/7-day/30-day)
- `lore_get_task_logs` — Read task logs from GCS

### Observability & Audit
- OpenTelemetry traces + metrics → Cloud Monitoring
- Structured commit trailers on all Lore-authored commits (append-only audit substrate)
- Pipeline audit log with decision reasoning (auto-merge rules, escalations, notifications)
- PR outcome feedback (files changed, time to merge, review comments)
- Session tracking (tool calls, exit dumps) with auto-curation

## Core Data Model

### Primary Entities

**Repository (lore.repos)**
- owner, name, team schema
- settings (dark_factory, task_overrides, trust_level, cross_repo_repos, incidents, slack_channel_id, test_commands)
- last_ingested_at, stale flag

**Pipeline Task (lore.pipeline.tasks)**
- UUID, task_type, repo_ref, branch, status (created/claimed/done/failed)
- Lore-Task trailer for PR traceability
- context_refs (JSONB) for retrieval strengthening on merge
- task_group_id for coordination
- session_id, agent_id

**GitHub Issue & PR**
- Issues created per task (labeled `lore-managed`; optional approval gate)
- PRs created on agent branches with `Lore-Task:` footer
- PR outcome tracking: merge/close stats, time-to-merge, review comments
- LoreTask CRD (Kubernetes custom resource) for cluster-side Job dispatch

**Knowledge Graph (memory schema)**
- Chunks: repo content + 768-d embeddings (PostgreSQL + pgvector with HNSW indexes)
- Episodes: raw text blobs from conversations, reviews, observations
- Facts: extracted from episodes with temporal validity (valid_from/valid_to), confidence (verified/observed/inferred/stale), retrieval metadata (count, last_retrieved_at, half_life_days)
- Entities & Edges: live knowledge graph updated on every episode ingest
- Memories: key-value store with optional TTL and version history
- Fact Conflicts: records when a new fact contradicts existing ones (cosine similarity >= 0.92)
- Memories & Facts: consolidated daily to extract higher-level patterns

**Audit & Observability (lore.pipeline.audit_log)**
- Event type, repo, task/PR/branch, decision (auto_merge_decision, escalation, notification), rule trace, timestamp
- Outcome stats per repo (files changed, time-to-merge, review comments)
- Session summaries and episode text

### Storage Layers

**PostgreSQL + pgvector (primary)**
- Schema-per-team (org_shared for cross-repo), CloudNativePG on GKE
- HNSW vector indexes (768-d embeddings)
- GIN indexes for BM25 keyword search
- Hybrid search via Reciprocal Rank Fusion
- Embeddings from Vertex AI text-embedding-005

**Dgraph (Knowledge Graph, optional)**
- Live entities + relationships
- Spec-trace graph (test→coverage→statements, validated_by/violated edges)

**File-backed Fallback**
- ~/.lore/memory/ (when DB unavailable)
- ~/.lore/local-tasks.json (local task state)
- ~/.lore/agent-id (persistent agent ID)
- ~/.lore/leases/ (lease files for worktree mode, FR1.6)

### Data Lifecycle

1. **Collect**: From repo files (CLAUDE.md, ADRs, runbooks, specs, code), PR history, agent sessions, explicit memory writes
2. **Store**: Chunk + embed (PostgreSQL), extract facts from episodes (LLM), update knowledge graph (entity extraction)
3. **Pull**: lore_assemble_context (one-call bundle), lore_search_context (hybrid search), lore_query_graph (entity relationships)
4. **Feedback**: Learnings from task completion feed back via lore_write_memory/lore_write_episode

## User Roles

### Developer
- **Context usage**: Call lore_assemble_context on session start, lore_search_memory for prior learnings, lore_search_context for patterns
- **Task delegation**: Use lore_create_pipeline_task for async work (>20 min tasks, well-defined)
- **Local execution**: lore_run_task_locally for interactive work in worktrees
- **Memory curation**: lore_write_memory / lore_write_episode on session end with learnings
- **Required workflow**: assemble context → search memory → work → write memory/episode

### Product Manager
- **Feature creation**: /lore-feature to turn plain-language idea into spec.md + tasks
- **Task tracking**: lore_ready_tasks, lore_claim_task, lore_complete_task
- **Delegation**: Create pipeline tasks with clear specs

### Platform Engineer
- **Repo onboarding**: UI (/onboard) or MCP (lore_onboard_repo) with auto-generated CLAUDE.md, AGENTS.md, specs, CI
- **Settings & tuning**: Dark factory mode, task overrides, trust levels, incident links, Slack channel mapping
- **Cluster management**: GKE deployment, PostgreSQL + pgvector administration, External Secrets Operator (ESO) integration
- **Monitoring**: OpenTelemetry traces, pipeline audit logs, memory health, session tracking
- **API security**: Bearer token management (per-client scoped tokens, HMAC verification for webhooks)

### Autonomous Agent (Claude CLI + MCP)
- **Ephemeral execution**: Single run of Claude + prompt in a Station (K8s Job pod or local sandbox)
- **Context injection**: Pre-loaded via /api/context before agent starts (no lore_assemble_context needed for first action)
- **Task execution**: Follows workflow YAML (gap-fill, general, implementation) with structured trailers
- **Memory integration**: Auto-curated episodes on task completion, fact extraction via Haiku
- **Review loop**: Optional 2-iteration feedback cycle before escalation to human

## Business Rules

### Context Assembly
- One-call retrieval with token budget (default 8K, research 16K)
- Stale warning when repo context >7 days old
- Cross-repo context filtered by transfer score (portable keywords boost, local keywords reduce; threshold 0.5)
- Subdirectory rules (.claude/rules/*.md) loaded conditionally by keyword match
- Recent incidents surfaced at priority 1
- Conflicts flagged with `[CONFLICT]` prefix when detected in past 7 days

### Task Pipeline
- Tasks created via UI, MCP, or GitHub Issue trigger
- Simple tasks use direct Anthropic API; implementation/review use K8s Job pods
- Deterministic validation mandatory (lint/typecheck on changed files only)
- One retry on validation failure; escalation to needs-human-help after that
- PR outcome feedback feeds importance adjustments (merge +5 half-life, reject -3, min 7)
- Retrieval count and last-retrieved-at updated asynchronously on every search (zero latency)

### Dark Factory Mode
- **Enablement**: Per-repo setting AND cluster env var (LORE_DARK_FACTORY_CLUSTER_ENABLED) both required
- **Issue creation**: Only for approval-gated tasks, on-the-fly escalations, or opt-in repos
- **Approval gates**: Two-key auth for privileged changes (admin scope + CODEOWNERS approval PR)
- **Auto-merge**: After [stage:retrospective], when green CI + path matches all changes + repo trust >= min_trust
- **Workflow resumption**: Branch-as-state; read last trailer on branch to resume after pod death
- **Audit**: All decisions logged with rule trace

### Memory & Knowledge
- Facts have temporal validity (valid_from/valid_to) and confidence tiers
- New fact contradicts existing (cosine >= 0.92) → auto-invalidate old, record conflict
- Stale facts (unretrieved 30+ days) transition to stale confidence tier
- Importance decay: daily job scores (0-10) via half-life model; evict lowest when >500 memories
- Consolidation: daily job groups 7-day facts by repo, Haiku extracts patterns
- Conflict surfacing: Context assembly flags facts with recent conflicts
- Fact eviction: Keep 2000 invalidated facts max, clean older ones daily

### Privacy & Security
- **Sanitization**: All memory writes pass through sanitizeContent() / redactSecrets() (strip API keys, JWTs, private keys, connection strings, bearer tokens)
- **API security**: Bearer token validation on every /api/* route; scoped tokens (read/write/task/webhook/admin); rate limiting (30/min webhooks, 60/min tasks, 200/min other); 1MB body limit
- **Webhook auth**: HMAC signature verification for GitHub, Slack
- **Pod security**: Non-root (uid 1000), dropped capabilities, no privilege escalation, NetworkPolicy egress restriction
- **Lease management**: Atomic acquire with takeover detection (DbLeaseBackend CTE or FileLeaseBackend per ~/.lore/leases/)

### Trust & Progression
- Progressive trust levels: docs → tests → implementation → full
- Auto-promote after 3 successful merges at current level
- Per-repo task-type overrides (model, timeout, system_prompt_suffix, review_required)

### Review & Escalation
- Autonomous review loop: up to 2 feedback iterations, then escalate
- Escalation to needs-human-help Issue with diagnostic, branch link, contributing refs
- Review reactor webhook-driven with business-hours safety cron (configurable TZ, start/end, days)
- Non-merge treated as rejection signal; merge boosts half-life on contributing facts

### Spec-Test Traceability (v3, 2026-06-02)
- Markdown inline links in spec.md: `Statement. ([validated by name](path/to/test.ts#L42))`
- Three write-paths: hand-written, /lore-suggest-links (MCP skill, subscription-billed), spec-coverage-backfill cron (weekly Mon 11:00 UTC, API-billed)
- Validate pass daily + post-ingest; file spec-link-rot issues on broken links
- Test-interface support: language-neutral test discovery (.lore/test-commands.yml), idempotent ingest, zero-LLM

### Prompt Caching
- Two cache breakpoints per LLM call (system block + tool schema)
- 1h TTL for jobs in LORE_CACHE_1H_JOBS allowlist (auto-curation, review_reactor, fact-extraction, graph-extraction); 5m default
- Cache hit / first-call / break:system / break:tools / break:ttl tracked per job
- Cost: 1.25x writes, 0.1x reads

## Success Metrics

### Context Quality
- **SC1**: Reduction in "I need context on X" questions during development (tracked via session analysis)
- **SC2**: Improvement in task completion time (baseline via dark_factory_baseline snapshot; delta vs. prior 30 days)
- **SC3**: Fact retrieval count and confidence distribution (higher confidence = better onboarding)
- **SC4**: Cross-repo context transfer score (portable knowledge successfully applied to new repos)
- **SC5**: Memory consolidation patterns (facts → higher-level learnings)
- **SC6**: Dark-factory task success rate (spec quality, implementation correctness, review efficiency)

### Task Pipeline
- **TP1**: Implementation success rate (first-attempt merge / one-retry-merge / escalation)
- **TP2**: Time-to-merge for agent-created PRs (vs. developer baseline)
- **TP3**: Auto-merge adoption rate (repos opting in to dark-factory mode)
- **TP4**: Review feedback iteration count (goal: ≤1 round before escalation)
- **TP5**: Validation catch rate (bugs found by deterministic checks before human review)

### Knowledge Accumulation
- **KA1**: Memory growth rate (memories + facts added daily; decay rate)
- **KA2**: Fact reuse rate (searches that retrieve previously-observed facts)
- **KA3**: Conflict resolution accuracy (facts invalidated due to true contradictions vs. false positives)
- **KA4**: Episode quality (Haiku-curated lessons captured per task completion)

### Operational
- **OP1**: Onboarding time (hours from repo discovery to first successful task)
- **OP2**: Cluster uptime and task SLA (P50/P99 task execution time)
- **OP3**: API rate-limit rejection rate (<1%)
- **OP4**: Storage growth (PostgreSQL size, pgvector index effectiveness)
- **OP5**: Cost per task (API spend, compute, storage)

### Adoption
- **AD1**: Developer session frequency (daily/weekly active developers)
- **AD2**: MCP tool usage distribution (which tools most common; dark-factory adoption)
- **AD3**: Memory retention (facts retrieved after 7/14/30 days; half-life calibration)
- **AD4**: Org-wide context reuse (cross-repo searches, shared pools)