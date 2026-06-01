# Feature Specification: Lore — Shared Context Infrastructure

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Lore Platform                              |
| Branch            | 1-lore-platform                            |
| Status            | Shipped                                    |
| Created           | 2026-03-25                                 |
| Updated           | 2026-06-01                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 3-4 working days                           |
| Full Stack Target | 6-8 weeks                                  |

> **Note (2026-04-13):** This spec has been updated to reflect the shipped
> implementation. Several technology choices changed after the initial spec:
> Beads + Dolt replaced by pipeline tasks in PostgreSQL (ADR-009), Klaus
> replaced by the purpose-built Lore Agent service (ADR-007), Graphiti/
> FalkorDB replaced by a PostgreSQL-backed live knowledge graph (ADR-010),
> and OCI Context Cores replaced by DB-cached context assembly. All changes
> are documented in `adrs/`.

> **Note (2026-04-20):** Further updates to reflect ADR-015 (accepted
> 2026-04-17) and post-April-13 implementation work. Key changes: the
> review reactor is now webhook-driven (not cron-polled), prompt caching
> added to all agent LLM calls, per-template context budgets introduced
> (8K default, 16K for research), and additional MCP tools shipped. A
> stuck-task terminal-state recovery mechanism was also added. All changes
> are reflected in FR-2, FR-13, and the new FR-16 and FR-17 below.

> **Note (2026-06-01):** Spec drift reconciliation covering three major
> features shipped after April 20: **Dark Factory mode** (ADR-016,
> 2026-04-28) — per-repo opt-out of human gates, branch-as-state commit
> trailers, declarative YAML workflow graphs, lease-backed concurrency,
> and auto-merge; **Web UI theming** (ADR-017, 2026-05-29) — two-axis
> token model (family + scheme), FOUC-free provider, per-family icon sets;
> **TDD + per-subproject CI** (ADR-018, 2026-05-29) — Red-Green-Refactor
> methodology, per-subproject vitest matrix, integration test isolation.
> Also captures cross-cutting additions: cross-repo context linking,
> per-repo task overrides, PR outcome feedback (merge/rejection half-life
> adjustment), transfer scoring for cross-repo facts, production
> awareness (incidents surface in context), and additional web UI
> components (stage timeline, specs browser). New requirements are
> FR-19 through FR-25 below.

## Problem Statement

Developers at Acme open Claude Code with no organizational context.
They must manually load conventions, architectural decisions, team
patterns, and sprint context every session. This friction means Claude
Code operates as a generic tool rather than an organization-aware
assistant. The result: inconsistent code, rediscovered decisions,
duplicated reasoning, and slower onboarding for new engineers.

## Vision

Every developer opens Claude Code and it already knows: org-wide
conventions, team-specific patterns, active architectural decisions,
PR history and the reasoning behind it, and current sprint context —
without any manual loading. One install command. Everything else
automatic.

## User Personas

### New Developer (Day 1)

A developer who has just joined Acme. They have no knowledge of org
conventions, team patterns, or architectural history. They need to
become productive without reading hundreds of pages of documentation.

### Active Developer (Daily Use)

A developer who works in one or more product repos daily. They need
Claude Code to understand their team's conventions, the reasoning
behind past decisions, and their current task state — automatically.

### Tech Lead / Architect

Reviews PRs, makes architectural decisions, and ensures consistency
across teams. They need the system to capture and distribute decisions
so they are not the bottleneck for "why did we do it this way?"
questions.

### Platform Engineer

Maintains the Lore infrastructure itself. They need observability
into what context is being served, where gaps exist, and how the
system is performing.

## User Scenarios & Acceptance Criteria

### Scenario 1: First-Time Setup

**Actor:** New Developer

**Flow:**
1. Developer runs a single install command.
2. System clones the context repository, builds the MCP server,
   detects the developer's team, configures Claude Code settings,
   installs platform skills, and runs a health check.
3. Developer opens Claude Code.
4. Claude Code greets them with team context loaded and suggests
   available work.

**Acceptance Criteria:**
- Installation completes in under 5 minutes on macOS and Linux.
- Health check reports all green on a clean machine with standard
  prerequisites (Node.js, Python, Git).
- Re-running the install command produces the same correct state
  with no errors or side effects (idempotent).
- The install command works without pre-cloning the repository.

### Scenario 2: Morning Orientation

**Actor:** Active Developer

**Flow:**
1. Developer opens Claude Code.
2. Context and task state sync automatically in the background.
3. Developer asks what to work on.
4. System shows unblocked tasks with priorities.
5. Developer claims a task and begins work.

**Acceptance Criteria:**
- Context sync completes silently without developer action.
- Task list shows only unblocked work.
- Claimed tasks are tracked automatically during the session.
- Claude Code can answer convention questions (e.g., "what are our
  error handling conventions?") without manual context loading.

### Scenario 3: Starting a New Feature

**Actor:** Active Developer

**Flow:**
1. Developer invokes the `/lore-feature` skill.
2. System asks what they want to build (one question).
3. System generates a project constitution from real ADRs and team
   conventions, shows it, asks for confirmation.
4. System generates a feature specification, shows it, asks for
   confirmation.
5. System generates a task breakdown, shows it, asks for
   confirmation.
6. System syncs tasks into the pipeline task store.
7. Developer sees their tasks and begins implementation.

**Acceptance Criteria:**
- The full loop completes in under 30 minutes.
- Developer speaks fewer than 10 words total — system does the work,
  developer confirms at decision points.
- Generated constitution reflects real team ADRs and conventions.
- Generated tasks have correct dependency relationships.

### Scenario 4: Opening a Pull Request

**Actor:** Active Developer

**Flow:**
1. Developer invokes the `/lore-pr` skill.
2. System reads the current task, spec file, changed files, and
   ADR references automatically.
3. System drafts a complete PR description with all required
   sections filled.
4. Developer reviews and edits the draft.
5. System reminds developer to mark the task as done.

**Acceptance Criteria:**
- PR description includes Why, Alternatives Rejected, ADR References,
  and Spec sections — all populated from existing context.
- Developer does not write the description from scratch.
- If no spec file exists, system asks one targeted question about
  alternatives rejected before finishing the draft.

### Scenario 5: Context Quality Enforcement

**Actor:** Any Developer (via CI)

**Flow:**
1. Developer opens a PR that modifies context files (CLAUDE.md, ADRs,
   team conventions).
2. CI runs context evaluation tests against the changes.
3. If the changes contradict established conventions (e.g., suggesting
   float storage for monetary amounts when the ADR requires integers),
   CI fails the PR.

**Acceptance Criteria:**
- CI fails PRs that contradict active ADRs.
- CI fails PRs with empty "Why" or "Alternatives Rejected" sections.
- Warning-only mode for the first 2 weeks, hard fail after.
- Eval pass threshold is 85%.

### Scenario 6: Semantic Context Search (Phase 1)

**Actor:** Active Developer

**Flow:**
1. Developer asks Claude Code a question about a specific code
   pattern or decision.
2. System performs hybrid search (vector + keyword) across the
   team's context store.
3. System returns relevant code chunks, PR discussions, and ADRs
   ranked by relevance.

**Acceptance Criteria:**
- Search returns relevant results in under 200ms (p99).
- A query like "ChargeBuilder idempotency" returns both the code
  chunk (matched by vector similarity) and the PR that introduced
  it (matched by keyword).
- Merging a PR with an alternatives-rejected section makes that
  reasoning searchable within 5 minutes.

### Scenario 7: Cluster Delegation (Phase 1)

**Actor:** Active Developer

**Flow:**
1. Developer identifies a well-defined task that will take more
   than 20 minutes (e.g., writing integration tests).
2. Developer asks Claude Code to delegate it to the cluster via
   `create_pipeline_task`.
3. System creates a LoreTask CR; the Lore Agent schedules an
   ephemeral K8s Job pod that runs Claude Code with pre-loaded context.
4. Developer continues local work while the Job pod runs independently.
5. Developer checks status with `get_pipeline_status` and retrieves
   results when ready. A GitHub Issue is automatically created and
   updated with task progress.

**Acceptance Criteria:**
- Task submission returns immediately with a tracking ID.
- Context bundle is pre-hydrated from the Lore API before the Job pod
  starts — the agent begins with conventions, ADRs, and memories.
- Developer can check task status and retrieve results without
  leaving Claude Code.
- The pipeline task is visible in the shared task tracker — no
  duplicate work.
- Watcher posts the PR link and any Slack notifications on completion.

### Scenario 8: Automated Gap Detection (Phase 2)

**Actor:** Platform Engineer (reviewer), System (initiator)

**Flow:**
1. Weekly job analyzes low-confidence context retrievals from the
   past week.
2. System clusters gaps by topic similarity.
3. For each gap cluster with 3+ occurrences, system drafts the
   missing content (CLAUDE.md addition, ADR, or runbook).
4. System opens a PR to the context repo with the draft, assigned
   to the relevant team.
5. Team reviews and merges or closes with feedback.

**Acceptance Criteria:**
- Gap detection identifies recurring low-confidence queries.
- Drafted content is specific and actionable (not just "add
  information about X").
- PRs are labelled and assigned to the correct team.
- Human review is required before any drafted content enters the
  shared context store.

### Scenario 9: Temporal Knowledge Graph Traversal (Phase 3)

**Actor:** Active Developer or Tech Lead

**Flow:**
1. Developer asks "why does the auth service work this way?"
2. System queries the live knowledge graph to traverse relationships:
   code → PR → ADR → Spec, including entity relationships and
   confidence-annotated facts.
3. System presents the chain of reasoning across sources.

**Acceptance Criteria:**
- `query_graph` returns multi-hop traversal results that vector
  search alone cannot answer.
- Graph entities carry typed relationships (OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES, etc.).
- Facts include confidence annotations (`verified`, `observed`,
  `inferred`, `stale`) and temporal validity.
- Conflicting facts are surfaced with a `[CONFLICT]` prefix.

## Functional Requirements

### FR-1: Context Repository

The system MUST maintain a single repository (`re-cinq/lore`) that
serves as the source of truth for organizational context.

- FR-1.1: Root `CLAUDE.md` with architecture contracts, code
  conventions, and key service descriptions (under 2 pages).
- FR-1.2: Per-team `CLAUDE.md` files under `teams/<team>/` (max
  1-2 pages each).
- FR-1.3: ADRs in MADR format with required YAML frontmatter
  (adr_number, title, status, date, deciders, domains, supersedes,
  superseded_by, related_prs).
- FR-1.4: Runbooks with required frontmatter (service, incident_type,
  severity, trigger, last_incident, last_updated).
- FR-1.5: CODEOWNERS file enforcing ownership boundaries.
- FR-1.6: Three-level CLAUDE.md hierarchy where more specific wins
  on conflicts (org > repo > team).

### FR-2: MCP Server

The system MUST provide an MCP server that serves context to Claude
Code sessions. It exposes 30+ tools grouped by function.

**Context tools:**
- FR-2.1: `assemble_context(query)` — unified context assembly with
  YAML templates; returns conventions, ADRs, memories, facts, and
  graph relationships in one call within a token budget.
- FR-2.2: `search_context(query, limit?)` — Phase 0: naive text
  match; Phase 1: hybrid vector + keyword search with Reciprocal
  Rank Fusion.
- FR-2.3: `search_memory(query)` — semantic search across memories
  and facts, including confidence annotations and conflict flags.

**Memory tools:**
- FR-2.4: `write_memory`, `read_memory`, `delete_memory`,
  `list_memories` — persistent key-value memory with TTL and
  version history.
- FR-2.5: `write_episode(text)` — ingest raw text; auto-extracts
  facts and updates the live knowledge graph.
- FR-2.6: `query_graph(query)` — multi-hop traversal of the live
  knowledge graph (entities + typed edges in PostgreSQL).

**Pipeline / task tools:**
- FR-2.7: `create_pipeline_task(type, description, repo?)` — create
  an agent task; returns a tracking ID.
- FR-2.8: `get_pipeline_status(task_id)` — poll task status.
- FR-2.9: `list_pipeline_tasks`, `cancel_task`, `retry_task` —
  task lifecycle management.
- FR-2.10: `list_task_group(group_id)` — show all tasks in a
  multi-repo group with completion status.
- FR-2.11: `run_task_locally`, `list_local_tasks`, `cancel_local_task`
  — local runner tools (worktrees, background Claude Code).

**Workflow tools:**
- FR-2.12: `sync_tasks(tasks_md)` — parse a tasks.md file and
  insert/update tasks in the pipeline store, respecting `[DEPENDS ON:]`
  annotations.
- FR-2.13: `ready_tasks` — list unblocked tasks for the current repo.
- FR-2.14: `claim_task(task_id)` — atomically claim a task using
  `SELECT ... FOR UPDATE SKIP LOCKED`. Rejected if already claimed.
- FR-2.15: `complete_task(task_id)` — mark a task done; unblocks
  dependents.

**Observability / repo tools:**
- FR-2.16: `get_task_logs(task_id)` — read task logs from GCS.
- FR-2.17: `my_usage` — per-developer token usage (today/7-day/30-day).
- FR-2.18: `agent_stats` — health, memory count, episode count,
  facts, searches, daily breakdown.
- FR-2.19: `onboard_repo(repo)` — create CLAUDE.md, AGENTS.md, PR
  template, and CI workflows on a target repo via PR.
- FR-2.20: Phase 0 implementation is file-backed; Phase 1 replaces
  storage backends without interface changes.
- FR-2.21: `get_pr_status(repo, pr_number)` — fetch live PR status
  (CI checks, review state, merge readiness) without leaving Claude Code.
- FR-2.22: `get_analytics(repo?)` — per-repo or org-wide task
  completion, token usage, and merge-rate metrics.
- FR-2.23: `list_repos` — list all onboarded repos with their trust
  level, last-ingest timestamp, and stale flag.
- FR-2.24: `ingest_files(repo, paths[])` — trigger ad-hoc ingestion
  for specific files; used after large refactors to keep search fresh
  without waiting for the nightly job.

**Extended local runner tools (added post-Phase-0):**
- FR-2.25: `enable_task_notifications` / `disable_task_notifications`
  — toggle statusline task-completion alerts.
- FR-2.26: `list_pending_tasks` — show tasks waiting for a human claim
  on this machine.
- FR-2.27: `claim_and_run_locally(task_id)` — atomic claim + local
  execution in a single call; eliminates the two-step claim → run
  sequence.
- FR-2.28: `skip_task(task_id, reason)` — mark a task skipped without
  failing it; releases the slot for another agent.
- FR-2.29: `configure_local_runner(options)` — update max concurrency,
  allowed task types, and model selection in `~/.lore/local-runner.json`.

### FR-3: Developer Onboarding

The system MUST provide a single-command install experience.

- FR-3.1: Install script clones the context repo, builds the MCP
  server, detects team, configures Claude Code settings, installs
  platform skills, and runs health checks.
- FR-3.2: Install script is idempotent — re-running always produces
  correct state.
- FR-3.3: Install script works without pre-cloning the repository.
- FR-3.4: Settings merge (via helper script) appends platform hooks
  without overwriting personal developer hooks.
- FR-3.5: Health check script tests all connections and prints clear
  pass/fail with fix instructions for each.

### FR-4: Task Tracking Integration

The system MUST provide agent-native task tracking via PostgreSQL
pipeline tasks and GitHub Issues.

- FR-4.1: `AGENTS.md` instructs Claude Code on task tracking
  commands and proactive guidance behavior.
- FR-4.2: Session start hook syncs task state automatically.
- FR-4.3: Session end hook reminds about open claimed tasks.
- FR-4.4: `sync_tasks` MCP tool converts tasks.md task output into
  pipeline tasks with dependency relationships parsed from
  `[DEPENDS ON: ...]` annotations.
- FR-4.5: Concurrent task claiming uses `SELECT ... FOR UPDATE SKIP
  LOCKED` — atomically prevents duplicate work without versioning
  overhead. A claim attempt on a taken task returns an immediate
  error; the developer or agent reads the ready list and picks
  another task.
- FR-4.6: Every pipeline task automatically creates a GitHub Issue
  on the target repo (labelled `lore-managed`). The issue receives
  status comments and is closed when the PR is created.
- FR-4.7: Optional approval gates: tasks can require a human to add
  an `approved` label on the GitHub Issue before processing.
  Configured via the settings UI or `lore.settings` table.

### FR-5: Spec-Driven Feature Workflow

The system MUST provide an end-to-end feature workflow via platform
skills.

- FR-5.1: `/lore-feature` skill guides the full loop: constitution
  generation → specification → task breakdown → pipeline task wiring.
- FR-5.2: `/lore-pr` skill drafts PR descriptions from spec, task
  context, and changed files.
- FR-5.3: Constitution generation calls `assemble_context` to
  populate `.specify/constitution.md` with real ADRs and team
  conventions.
- FR-5.4: Claude Code does mechanical work; developer confirms only
  at decision points (constitution review, spec review, task
  breakdown review).

### FR-6: PR Quality Enforcement

The system MUST enforce PR description quality from day one.

- FR-6.1: PR template with required sections: Why, Approach,
  Alternatives Rejected, ADR References, Spec.
- FR-6.2: CI check fails PRs with empty Why or Alternatives Rejected
  sections.
- FR-6.3: Warning-only mode for first 2 weeks, hard fail after.
  Transition from warning to enforcement is a manual flip by the
  platform team via a configuration flag in the CI workflow. No
  automatic date-based cutoff.

### FR-7: Ingestion Pipeline (Phase 1)

The system MUST ingest content from multiple sources into the vector
store via the Lore Agent service.

- FR-7.1: Fast path: on-push to main triggers incremental ingestion
  via pipeline task.
- FR-7.2: Full path: nightly job triggers complete re-index via
  pipeline task.
- FR-7.3: Content types: code (AST-split), pull requests (diff +
  description + comments), ADRs, docs (section-chunked), specs,
  runbooks.
- FR-7.4: PII classifier runs at ingest time; sensitive content
  excluded from general search.
- FR-7.5: Lore Agent understands context semantically — it drafts
  missing content and opens PRs, not just chunks and embeds.
- FR-7.6: Nightly re-index MUST hard-delete chunks whose source
  file, PR, or ADR no longer exists or has been superseded. No
  stale content is retained.

### FR-8: Observability (Phase 1)

The system MUST provide observability into context retrieval quality.

- FR-8.1: All MCP retrieval calls traced via OpenTelemetry spans
  exported to Cloud Monitoring.
- FR-8.2: Low-confidence retrievals (score < threshold) tagged as
  gap candidates via OTEL span attributes and Cloud Monitoring
  custom metrics.
- FR-8.3: Gap signal feeds the autoresearch loop (ADR-010): Langfuse
  low-confidence trace queries → candidate generation → PromptFoo eval
  → PR for automated context improvement.
- FR-8.4: `my_usage` tool exposes per-developer token consumption
  (today / 7-day / 30-day) without leaving Claude Code.

### FR-9: Context Evaluation (Phase 1)

The system MUST validate context quality via CI.

- FR-9.1: PromptFoo eval suite with 5-10 test cases per team
  (stored in `evals/`).
- FR-9.2: Teams own their eval cases.
- FR-9.3: Pass threshold: 85% required to merge.
- FR-9.4: Evals triggered on changes to ADRs, team CLAUDE.md files,
  root CLAUDE.md, and spec files.

### FR-10: Gap Detection (Phase 2)

The system MUST automatically identify and address knowledge gaps.

- FR-10.1: Weekly job analyzes low-confidence retrievals from the
  previous week.
- FR-10.2: Gaps clustered by embedding similarity.
- FR-10.3: For clusters with 3+ occurrences, Lore Agent drafts
  the missing content.
- FR-10.4: Agent opens PRs to the context repo with drafted content,
  assigned to the relevant team.
- FR-10.5: Human review required before any auto-drafted content is
  merged.

### FR-11: Live Knowledge Graph (Phase 1+)

The system MUST support traversable knowledge via a PostgreSQL-backed
live knowledge graph.

- FR-11.1: Knowledge graph stored in `memory.entities` and
  `memory.edges` tables in PostgreSQL. Updated incrementally on
  every `write_episode` call via the Lore Agent fact extractor.
- FR-11.2: Entity types: Service, Team, Function, PR, ADR, Spec,
  Concept, Runbook. Typed relationships: OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES.
- FR-11.3: `query_graph(query)` MCP tool traverses the live graph
  for multi-hop relationship results.
- FR-11.4: Facts carry temporal validity (`valid_from`/`valid_to`),
  confidence tiers (`verified` / `observed` / `inferred` / `stale`),
  and retrieval metadata (`retrieval_count`, `last_retrieved_at`,
  `half_life_days`).
- FR-11.5: Contradiction detection: when a new fact has cosine
  similarity ≥ 0.92 to an existing one, the old fact is invalidated
  and a conflict record written to `memory.fact_conflicts`. Context
  assembly prefixes `[CONFLICT]` on facts with recent (7-day)
  conflicts.

### FR-12: Intelligent Memory Lifecycle (Phase 1)

The system MUST manage agent memory automatically without agent
cooperation.

- FR-12.1: MCP server tracks all tool calls in a 500-entry ring
  buffer (`session-tracker.ts`). On exit, dumps to
  `~/.lore/last-session.json`. Stop hook POSTs to
  `/api/session-summary` for automatic episode + fact extraction.
- FR-12.2: Daily job at 5 AM scores memories 0-10 using half-life
  decay (`strength = 0.5^(age / half_life_days)`). Evicts
  lowest-scoring memories when agent exceeds 500 entries. Cleans
  invalidated facts older than 30 days beyond the 2000 cap.
- FR-12.3: Daily job at 5:30 AM groups recent facts (7-day lookback)
  by repo and calls Haiku to extract 1-3 higher-level patterns per
  repo. Stored as `consolidated/{repo}/{timestamp}` memories.
  Minimum 5 facts required to trigger consolidation.
- FR-12.4: Every `search_memory` call asynchronously increments
  `retrieval_count`, updates `last_retrieved_at`, and extends
  `half_life_days` (+2, cap 365) on returned facts. Stale facts
  revive to `observed` on retrieval. Fire-and-forget — adds zero
  latency to search.
- FR-12.5: After every pipeline task completion (PR, no-changes,
  failure), an episode is automatically written. For high-signal
  events (PRs, failures), Haiku extracts a lesson and stores it
  as `auto-curation/{ref}` memory.

### FR-13: Autonomous Review Loop (Phase 1, opt-in)

The system MUST support an opt-in autonomous review loop per repo.
**Updated 2026-04-20 per ADR-015**: the reactor is now webhook-driven;
cron is a safety net only.

- FR-13.1: After an implementation PR is created, the loretask-watcher
  automatically creates a review LoreTask CR (if `auto_review` is
  enabled on the repo).
- FR-13.2: Review Job pod clones the PR branch, reads spec +
  conventions, posts PR comments via `gh`, and outputs APPROVED or
  CHANGES_REQUESTED.
- FR-13.3: On APPROVED: task marked reviewed; PR ready for human
  merge.
- FR-13.4: On CHANGES_REQUESTED (iteration < 2): new implementation
  LoreTask created on the same branch with feedback as context.
- FR-13.5: On CHANGES_REQUESTED (iteration ≥ 2): escalate to human
  review. No further autonomous iterations.
- FR-13.6: **Primary trigger is GitHub webhooks** (ADR-015). The
  mcp-server webhook handler accepts `pull_request` events
  (`synchronize`, `opened`, `reopened`, `ready_for_review`),
  `pull_request_review.submitted`, and `issue_comment.created` (on
  PRs). For qualifying events, mcp-server POSTs `{repo, pr_number}`
  to `POST /api/trigger/review-reactor` on the agent service,
  authenticated via `LORE_AGENT_INTERNAL_TOKEN`. Agent returns
  `202 Accepted` and runs in the background.
- FR-13.7: **Safety-net cron** fires at `7 7-17 * * 1-5` (UTC,
  Mon-Fri) to catch dropped webhook deliveries. Cron-triggered runs
  are gated by `isBusinessHours()` (default: Europe/Berlin, 09:00-18:00
  Mon-Fri via `LORE_BUSINESS_HOURS_{TZ,START,END,DAYS}` env vars).
  Webhook-triggered runs are never gated by business hours.
- FR-13.8: Webhook path silently degrades if `LORE_AGENT_URL` or
  `LORE_AGENT_INTERNAL_TOKEN` are missing — mcp-server logs a warning
  but continues accepting webhooks (safety-net cron covers the gap).

### FR-14: Spec Drift Detection (Phase 2)

The system MUST detect when specifications diverge from implementation.

- FR-14.1: Weekly job reads spec assertions and checks against
  current code via AST analysis.
- FR-14.2: Divergence above 20% of assertions triggers a `gap-fill`
  pipeline task for the owning team.
- FR-14.3: Test files and generated files are excluded.

### FR-15: Progressive Trust (Phase 1)

The system MUST gate task types per-repo based on demonstrated
reliability.

- FR-15.1: `settings.trust.level` controls which task types are
  allowed: `docs` (gap-fill/runbook), `tests` (+review),
  `implementation` (+implementation/feature-request/general),
  `full` (all).
- FR-15.2: Auto-promotes after 3 successful merges at the current
  level. Defaults to `implementation` for backward compatibility.

### FR-16: Prompt Caching on Agent LLM Calls (Phase 1)

The system MUST cache repeated LLM prefixes on all agent-side Anthropic
API calls to reduce token cost. Added 2026-04-17 per ADR-015.

- FR-16.1: `callLLM` and `callLLMWithTool` in `agent/src/anthropic.ts`
  place two cache breakpoints per request — one on the system prompt
  block, one on the tool schema block — so a tool-schema edit cannot
  bust the system cache and vice versa.
- FR-16.2: `getCacheControl(jobName)` from `agent/src/lib/prompt-cache.ts`
  returns `{type: "ephemeral", ttl: "1h"}` for jobs in the
  `LORE_CACHE_1H_JOBS` allowlist and `{type: "ephemeral"}` (5-min)
  otherwise. Default allowlist: `auto-curation`, `review_reactor`,
  `fact-extraction`, `graph-extraction`. Special values: `none`
  disables 1h everywhere; `*` enables it for every job.
- FR-16.3: Cache eligibility is latched at module load to prevent
  mid-process toggles from busting the server-side cache.
- FR-16.4: Each call computes a djb2 hash of the system + tools prefix
  and compares to the last call for the same `jobName`. Log line
  emits: `cache hit | first-call | break:system | break:tools |
  break:ttl(Nm)`.
- FR-16.5: `response.usage.cache_creation_input_tokens` and
  `cache_read_input_tokens` feed cost accounting (1.25× writes,
  0.1× reads).
- FR-16.6: MCP-server raw fetch call sites (fact extraction, graph
  extraction) have static prefixes below Haiku's 2048-token cache
  minimum — caching is not applied there.

### FR-17: Per-Template Context Budgets (Phase 1)

The system MUST apply different token budgets per context-assembly
template to avoid over-sending context on constrained flows.
Added 2026-04-17 per ADR-015.

- FR-17.1: Default `assembleContext` budget: 8K tokens (down from 16K).
  Research template keeps 16K (memory-heavy queries need it).
  Implementation and review templates cap at 8K.
- FR-17.2: The `assemble_context` MCP tool's `max_tokens` parameter
  default is 8K. Callers may pass a higher value explicitly.
- FR-17.3: Template-level budgets are declared in the YAML template
  files under `mcp-server/templates/`.

### FR-18: Stuck-Task Terminal-State Recovery (Phase 1)

The system MUST detect and surface pipeline tasks that are stuck in
non-terminal states and resolve them without manual intervention.

- FR-18.1: A `stale_task_check` job runs hourly at `:17` and flags
  tasks in `running` or `pending` state for longer than their
  configured timeout plus a grace period.
- FR-18.2: Stuck tasks are transitioned to a terminal state
  (`failed` with reason `timeout_exceeded`) so the pipeline does not
  stall waiting for a pod that has already exited.
- FR-18.3: The transition is idempotent — if a task completes between
  detection and the state write, the write is a no-op.
- FR-18.4: A failure episode is written for each stuck task so the
  auto-curation pipeline can surface patterns (e.g. a task type that
  consistently times out).

### FR-19: Dark Factory Mode (Phase 1+, ADR-016)

The system MUST support a per-repo, opt-in mode that minimises human
interrupt artifacts while maintaining a full audit trail. Added
2026-04-28 per ADR-016.

**Two-gate enablement:**
- FR-19.1: Dark-factory mode is active for a repo only when BOTH
  `lore.repos.settings.dark_factory.enabled = true` AND the cluster
  env var `LORE_DARK_FACTORY_CLUSTER_ENABLED=true` are set. Either
  gate off reverts to the legacy `claude --print` path. The cluster
  gate prevents a helm flag from getting ahead of the claude-runner
  image that must ship compiled workflows.

**Branch-as-state (no parallel ledger):**
- FR-19.2: Every workflow phase ends with a git commit carrying
  structured trailers: `Lore-Stage:`, `Lore-Iteration:`, `Lore-Task:`,
  plus optional `Lore-Outcome:` and `Lore-Cost-Tokens:`. Trailers are
  emitted unconditionally on every Lore-authored commit regardless of
  dark-mode setting (they are the audit substrate for both modes).
  Implemented in `shared/src/commit-trailers.ts` and exported via
  `@re-cinq/lore-shared`.
- FR-19.3: A supervisor pod that dies resumes by reading
  `git log` on the branch for the last `Lore-Stage:` trailer and
  following the outcome-matching outgoing edge. No database
  checkpoints, no CR status sync.
- FR-19.4: Concurrency is enforced by a `pipeline.task_leases` row
  keyed on branch name with a TTL (default 10 minutes). `DbLeaseBackend`
  uses a Postgres CTE-based atomic acquire with takeover detection.
  `FileLeaseBackend` covers the local worktree path under
  `~/.lore/leases/`. Both share a `LeaseBackend` interface
  (`agent/src/supervisor/lease.ts`).
- FR-19.5: A `lease-reaper` job runs every 60 seconds, deletes leases
  more than 5 minutes past expiry, and writes `lease_expired` audit
  entries.

**Declarative workflow graphs:**
- FR-19.6: Workflows are defined as YAML files at
  `agent/src/workflows/<task-type>.yaml`. Four node types: `agent`
  (LLM call + edits), `validate` (lint/typecheck), `gate` (named
  conditions), `retrospective` (episode + curated memory). Four edge
  conditions: `success | changes_requested | failed | always`. Cycles
  require `iteration_max` on the back-edge. Loader validates the schema
  and runs DFS cycle detection (`agent/src/workflow/loader.ts`).
- FR-19.7: The graph executor (`agent/src/supervisor/graph-executor.ts`)
  walks from `entry`, dispatches per-node-type handlers, emits a stage
  commit (allow-empty for non-file-changing nodes), and refreshes the
  lease before each node. The same YAML file drives both the local
  runner and the GKE cluster supervisor (FR2.3).
- FR-19.8: The Job pod CLI entry point (`agent/src/supervisor/runner-cli.ts`)
  is invoked by `entrypoint.sh` when `LORE_DARK_FACTORY_WORKFLOW` is
  set. It exits with a documented code matrix:
  `0` success, `2` config error, `3` workflow not found, `4` load
  error, `5` entry-node dispatch error, `6` graph cycle, `7` lease
  acquire failure, `8` resume parse error, `9` unexpected runtime
  error. Non-zero codes surface in pod logs and loretask-watcher
  failure reasons.

**Auto-merge:**
- FR-19.9: After the `[stage:retrospective]` node, the auto-merge
  engine evaluates: green CI + bot APPROVED + every changed path
  matches at least one allowlist glob (`allPathsMatch()`) + repo trust
  ≥ `auto_merge.min_trust` → squash-merge. Decision and winning/losing
  rule traces are recorded in `pipeline.audit_log` as
  `auto_merge_decision` (`agent/src/jobs/auto-merge.ts`).
- FR-19.10: Auto-merge path allowlist uses `minimatch` globbing
  (`agent/src/lib/path-match.ts`). Returns true only when **every**
  changed path matches at least one allowlist entry — a single
  out-of-allowlist file blocks auto-merge.

**Settings and authorization:**
- FR-19.11: The `dark_factory` settings block schema and
  `resolveSettings()` defaults live in
  `shared/src/dark-factory-settings.ts` (canonical) and are re-exported
  from `mcp-server/src/dark-factory-settings.ts`. Privileged fields
  (`enabled` toggle, `auto_merge.paths`, downgrade of `require_*` to
  false) require two-key authorization: admin API scope plus an open PR
  labeled `dark-factory-approval` by a CODEOWNER of the repo's
  `CLAUDE.md` (`mcp-server/src/dark-factory-authz.ts`).
- FR-19.12: The `GET /api/repos/:o/:r/settings/dark-factory` and
  `PUT` counterpart are in `mcp-server/src/routes.ts`. PUT enforces
  two-key authZ via `verifyApproval()` before writing privileged fields.

**Audit, escalation, and notifications:**
- FR-19.13: Every auto-merge decision, gate evaluation, and lease event
  is written to `pipeline.audit_log` via `writeAuditLog()`
  (`agent/src/lib/audit.ts`).
- FR-19.14: `escalate()` (`agent/src/lib/escalation.ts`) creates a
  `needs-human-help` GitHub Issue with diagnostic context, branch link,
  and contributing refs. Falls back to audit-only Slack inline if Issue
  creation fails (3-attempt backoff).
- FR-19.15: `decideNotify()` (`agent/src/lib/notify.ts`) filters
  notifications by the `dark_factory.notify` channel list. Dark-mode
  repos suppress Slack noise on routine completions.
- FR-19.16: Every Lore-authored PR body includes a standard footer
  with `Lore-Task: <uuid>` and optional `Refs #N`, composed by
  `prFooter()` (`agent/src/lib/pr-body.ts`).

**Metrics baseline:**
- FR-19.17: A daily job (`agent/src/jobs/dark-factory-baseline.ts`)
  writes a 30-day counter snapshot per repo to
  `pipeline.dark_factory_baseline`. These counters feed the SC1/SC4/SC6
  success-criteria deltas tracked during the pilot.

**Issue suppression:**
- FR-19.18: When `dark_factory.enabled = true`, GitHub Issues are
  created only for approval-gated tasks, on-the-fly escalations
  (`needs-human-help`), or repos with `create_issue: always`. The PR
  and its `Lore-Task:` trailer are the canonical artifacts.

### FR-20: Web UI Theming (Phase 1, ADR-017)

The web UI MUST support two switchable visual families (Elegant and
Retro), each with light, dark, and auto (OS-following) colour
schemes, with no FOUC and no per-component theming code. Added
2026-05-29 per ADR-017.

- FR-20.1: Two independent axes applied as `data-theme-family`
  (`elegant | retro`) and `data-color-scheme` (`light | dark`) on
  `<html>`. Each axis persists independently in `localStorage`
  (`lore-theme-family`, `lore-color-scheme`). User preference `auto`
  is resolved to a concrete scheme before reaching the DOM. Defaults:
  `elegant` + `auto`.
- FR-20.2: A hand-rolled `ThemeProvider` (~90 lines) + pure
  `theme-core.ts` (`resolveColorScheme`, `parseFamily`,
  `parseSchemePref`) replaces any third-party theme library. It is
  fully typed to the `ThemeFamily` and `ColorSchemePref` unions and
  unit-tested.
- FR-20.3: A blocking inline `THEME_SCRIPT` (dependency-free IIFE)
  runs as the first child of `<body>`, reads `localStorage`, resolves
  `auto` via `matchMedia`, and sets both `data-*` attributes before
  first paint. The server renders no theme attributes; the IIFE avoids
  all hydration mismatches.
- FR-20.4: `theme.css` is the single source of truth for all colour
  and size tokens. Family-level blocks hold shape, type scale, and
  glass tokens; four `[data-theme-family][data-color-scheme]` blocks
  hold surface/border/text/accent/status/shadow palettes. No hardcoded
  colour or `font-size` literal may appear in any `src/` file outside
  `theme.css` and `globals.css`.
- FR-20.5: An `<Icon name="…"/>` component maps a semantic `IconName`
  to the active family's Iconify icon set (`lucide:*` for Elegant,
  `pixelarticons:*` for Retro). Collections are registered offline from
  `@iconify-json/lucide` and `@iconify-json/pixelarticons`. A unit test
  asserts both families define every semantic icon name.
- FR-20.6: The `ThemeSwitcher` (family text toggle + Light/Auto/Dark
  icon toggle as accessible radio groups) lives only on `/settings`
  (Appearance section). Theme preference is device-local.

### FR-21: Testing Strategy (ADR-018)

The system MUST enforce a consistent testing methodology and a CI
unit-test gate across all subprojects. Added 2026-05-29 per ADR-018.

- FR-21.1: New production code MUST be written TDD (Red-Green-Refactor):
  write a failing test first, make it pass with the minimum code, then
  refactor. Test-after (characterization) is permitted only for
  pre-existing untested code.
- FR-21.2: vitest is the standard runner across all subprojects
  (`globals: true`, node environment). No migration to jest.
- FR-21.3: `.github/workflows/test.yml` runs one job per subproject
  (`shared`, `mcp-server`, `agent`, `web-ui`) with `fail-fast: false`.
  A failure names exactly which suite broke. `mcp-server` and `agent`
  build `@re-cinq/lore-shared` first (they consume its compiled output).
  `web-ui` is installed in place (`npm --prefix web-ui install`) because
  it is not a workspace member.
- FR-21.4: Integration tests are isolated behind
  `vitest.integration.config.ts` and the Postgres-backed
  `test-integration.yml` workflow. They are excluded from the default
  `vitest run` and from the unit matrix to avoid a Postgres prerequisite
  on unit runs.
- FR-21.5: `dist/**` is excluded from vitest discovery in `agent` and
  `mcp-server` to prevent stale compiled copies of tests (which reference
  bundled `dist/workflows` that only exist inside the Docker image) from
  producing spurious failures on a clean source tree.

### FR-22: Cross-Repo Context Linking

Repos MAY declare links to other repos for shared context retrieval.

- FR-22.1: `settings.cross_repo_repos` is an array of `owner/repo`
  slugs. When set, `assemble_context` searches linked repos for relevant
  context in addition to the requesting repo.
- FR-22.2: Links are bidirectional: adding repo B from repo A's settings
  auto-adds repo A to repo B's `cross_repo_repos` list.
- FR-22.3: Cross-repo facts are filtered by a transfer score: portable
  keywords (`error`, `pattern`, `gotcha`, `convention`) boost the score;
  local keywords (`config`, `deploy`, `url`, `auth`, `secret`) reduce
  it. Only facts scoring ≥ 0.5 are transferred. Prevents repo-specific
  configuration from polluting other repos.

### FR-23: Per-Repo Task Overrides

Repos MAY override global task-type defaults for any pipeline task.

- FR-23.1: `settings.task_overrides` is a map from task type name to
  override fields: `model`, `timeout_minutes`, `system_prompt_suffix`,
  `review_required`. Overrides are merged with the global
  `scripts/task-types.yaml` at task creation time; repo values win.

### FR-24: PR Outcome Feedback

The system MUST use PR merge and rejection signals to adjust memory
half-life for facts that contributed to each task's context.

- FR-24.1: The `merge-check` job captures PR stats on merge (files
  changed, time to merge, review comments) and writes curated
  episodes. It detects closed-without-merge as a rejection signal and
  tracks aggregate `outcome_stats` per repo.
- FR-24.2: On merge, `half_life_days` is boosted (+5) for facts and
  memories listed in `pipeline.tasks.context_refs`. On rejection,
  `half_life_days` is penalised (-3, minimum 7 days).
- FR-24.3: Contributing context refs are tracked in the
  `pipeline.tasks.context_refs` JSONB column from the moment a task
  starts.

### FR-25: Production Awareness and Additional Web UI

The system MUST surface active incidents in assembled context and
provide web UI views for pipeline timelines and specs.

- FR-25.1: `settings.incidents` (populated via `POST /api/webhook/incident`
  for PagerDuty/Opsgenie payloads) surfaces recent incidents in
  `assemble_context` output at priority 1, giving agents immediate
  awareness of ongoing production issues.
- FR-25.2: A stage-commit timeline component (`web-ui/src/app/pipeline/[id]/Timeline.tsx`)
  renders a vertical per-stage view with node-type icons, outcome badges,
  and a lease indicator. It polls `GET /api/pipeline/:id/timeline` every
  10 seconds while the task is in flight.
- FR-25.3: A global specs browser at `/specs` queries all team schemas
  via `queryAllChunks`, filters on `content_type = 'spec'`, and shows
  the 50 most-recent with per-repo filter buttons.
- FR-25.4: A per-repo spec view at `/repos/:owner/:repo/specs` scopes
  results to one team schema and includes a server action form
  (`addSpec`) that inserts spec chunks directly into
  `{schema}.chunks` with `content_type = 'spec'`.

## Non-Functional Requirements

### NFR-1: Security

- No long-lived credentials anywhere in the system.
- Workload Identity for all GKE workloads.
- Workload Identity Federation for GitHub Actions.
- Schema-per-team isolation in the vector store.
- PII classification at ingest time.
- All memory writes pass through `sanitizeContent()` / `redactSecrets()`
  to strip API keys, JWTs, private keys, connection strings, and bearer
  tokens before storage in the org-wide database.
- Centralized auth in `routes.ts`: every `/api/*` route enforces bearer
  token validation. Supports legacy single token (`LORE_INGEST_TOKEN`)
  and per-client scoped tokens with SHA-256 hashes.
- Job pods run as non-root (uid 1000), drop all Linux capabilities,
  disallow privilege escalation. NetworkPolicy restricts egress to
  DNS + HTTPS + internal Lore API only.
- Rate limiting: 30/min webhooks, 60/min task ops, 200/min other
  (in-memory sliding window). 1 MB body size limit.
- Slack indexing opt-in per channel only; DMs never indexed.

### NFR-2: Performance

- Context search returns results in under 200ms (p99) once
  infrastructure is deployed. **Note (2026-03-28):** Hybrid search
  (Vertex AI embedding + HNSW + BM25 + RRF) is functional end-to-end
  but p99 latency has not been benchmarked yet. The 200ms target
  remains aspirational until measured under load.
- Install script completes in under 5 minutes.
- Session start context sync completes in under 5 seconds.
- Incremental ingestion completes within 5 minutes of a merge.
- `assemble_context` warns when repo context is stale (>7 days since
  last ingest) or missing (first-run welcome with suggested actions).

### NFR-3: Reliability

- Install script is idempotent with no side effects on re-run.
- Platform hooks fail silently rather than blocking developer work.
- Health check script diagnoses all connection issues with fix
  instructions.
- When the MCP server is unreachable, Claude Code MUST fall back to
  the last-synced local copy of CLAUDE.md files and ADRs in
  `~/.re-cinq/lore` and display a one-time warning to the developer
  that search quality may be degraded. Semantic search is unavailable
  in this mode; convention and ADR lookups continue from local files.
- Agent deployments do NOT affect running Job pods — tasks survive
  rollout restarts.

### NFR-4: Scalability

- CloudNativePG (CNPG) PostgreSQL instance on existing shared GKE
  cluster (`your-gke-cluster`, `europe-west1`). Scale up CNPG resource
  requests when query latency p99 exceeds 50ms. Upgrade path to
  AlloyDB Omni or managed AlloyDB if needed.
- GKE cluster is shared — Lore workloads run in dedicated namespaces
  (`mcp-servers`, `lore-agent`, `lore-ui`) on the existing cluster.
- Revisit vector store choice only if corpus exceeds 100M vectors.

### NFR-5: Governance

- Root CLAUDE.md changes require broad review (platform-eng +
  tech-leads).
- Team CLAUDE.md files owned by respective teams.
- ADR changes require arch-group + affected team review.
- Architecture decisions changed only via superseding ADR with
  full alternatives-rejected documentation.

## Clarifications

### Session 2026-03-25

- Q: What happens when the MCP server is unreachable during a developer session? → A: Fall back to local `~/.re-cinq/lore` files with a one-time warning that search quality is degraded.
- Q: What happens to ingested chunks when their source is deleted, reverted, or superseded? → A: Hard delete. Nightly re-index removes chunks whose source no longer exists. No stale content retained.
- Q: How are concurrent task claims resolved? → A: `SELECT ... FOR UPDATE SKIP LOCKED` — atomic, no versioning overhead. Claim attempt on taken task returns immediate error.
- Q: What happens when a Lore Agent Job pod fails mid-task? → A: Fail immediately, update pipeline task with error reason, post Slack notification if channel mapped. No automatic retry — developer decides whether to resubmit via `retry_task`.
- Q: How does the PR check transition from warning to enforcement mode? → A: Manual flip by platform team via CI config flag. No automatic date-based cutoff.

### Session 2026-04-13 (spec update)

- Q: Why was Beads replaced? → A: Beads + Dolt had integration complexity and `bd` CLI instability. Pipeline tasks in PostgreSQL provide atomic claiming, dependency tracking, and full audit history without an external CLI dependency. (ADR-009)
- Q: Why was Klaus replaced? → A: Klaus was Giant Swarm's agent, not purpose-built for Lore. The Lore Agent service provides direct Anthropic API access, LoreTask CRD for ephemeral K8s Jobs, pre-run context hydration, deterministic validation, and full lifecycle control. (ADR-007)
- Q: Why no Graphiti / FalkorDB? → A: PostgreSQL-backed live knowledge graph provides the same traversable fact store without an additional graph database dependency. (ADR-010)
- Q: Why no OCI Context Cores? → A: DB-cached context assembly with the `assemble_context` tool provides equivalent freshness guarantees without OCI registry infrastructure overhead. (ADR-010)

### Session 2026-04-20 (spec update — ADR-015 + post-April-13 work)

- Q: Why switch from cron-polling to webhooks for the review reactor? → A: Polling every 5 minutes burned API quota and GitHub rate-limit budget on ticks that did nothing. Webhooks fire only on actual PR state changes; review latency drops from avg ~2.5 min to seconds. (ADR-015)
- Q: Why keep the safety-net cron at all? → A: A dropped webhook delivery stalls a PR until a human notices. A business-hours safety cron is nearly free and catches stragglers. Off-hours ticks are a pure waste so the cron is gated by `isBusinessHours()`. (ADR-015)
- Q: Why was the context budget cut from 16K to 8K by default? → A: Implementation and review flows only need conventions + the immediate diff. 16K was over-sending context and paying unnecessary token costs. Research keeps 16K because it needs broad memory coverage. (ADR-015)
- Q: Why prompt-cache at the system + tool-schema boundary separately? → A: A tool-schema edit would otherwise bust the system-prompt cache entry. Separate breakpoints ensure each can be reused independently. (ADR-015)
- Q: What is the `LORE_WEBHOOK_SECRET` latent bug that ADR-015 fixed? → A: The secret existed in GCP Secret Manager and had an ExternalSecret CR, but was never mounted into the mcp-server pod. `handleGitHubWebhook` always returned `503 "webhook secret not configured"`. ADR-015 mounted the secret and the webhook path now validates HMAC signatures correctly.
- Q: Why add `FR-18` (stuck-task recovery) now? → A: Job pods that exit without writing a terminal status left tasks stuck in `running` forever. The loretask-watcher had no mechanism to detect this until the `stale_task_check` hourly job was added (commit f203952, 2026-04-20).

### Session 2026-06-01 (spec drift reconciliation — ADR-016, ADR-017, ADR-018)

- Q: Why introduce Dark Factory mode as an opt-in rather than the default? → A: Repos with active human reviewers get value from the existing chatter (Issues, review comments, Slack ticks). Dark mode is for repos where the team has stopped reading bot artifacts and wants the PR as the sole durable artifact. Defaulting dark would break existing reviewer workflows. (ADR-016)
- Q: Why a two-gate (per-repo AND cluster env var) for dark mode? → A: The cluster gate (`LORE_DARK_FACTORY_CLUSTER_ENABLED`) prevents a helm flag from enabling dark-mode execution before the claude-runner image ships the compiled workflow files. Either gate off → safe legacy path. (ADR-016)
- Q: Why are commit trailers emitted even for non-dark-mode repos? → A: The trailers are the audit substrate — they let both modes share the same resume and observability logic. A non-dark repo that loses a pod mid-run still benefits from branch-as-state resume. (ADR-016)
- Q: Why hand-roll the ThemeProvider rather than using `next-themes`? → A: `next-themes` models a single theme axis. Two independent axes (`family` + `scheme`) that can each be `auto` would require re-implementing scheme resolution anyway. A ~90-line typed provider is smaller and fully typed to our unions. (ADR-017)
- Q: Why per-subproject CI jobs rather than one root `vitest run`? → A: A single root run hides which subproject failed, couples web-ui's non-workspace install to the root install, and would drag the Postgres requirement onto pure-unit runs. Per-job `fail-fast: false` means one red suite never masks another. (ADR-018)
- Q: Why exclude `dist/**` from vitest discovery? → A: After a local build, vitest was discovering stale compiled `dist/__tests__/*.js` copies that resolve `dist/workflows` — a directory that only exists inside the Docker image. They failed on a clean source tree even though the `src` suite was green. (ADR-018)

## Scope Boundaries

### In Scope

- Context repository structure and content.
- MCP server (file-backed Phase 0, PostgreSQL/pgvector-backed Phase 1+).
- Developer onboarding (install script, health check, settings merge).
- Task tracking integration (pipeline tasks + GitHub Issues + AGENTS.md + hooks).
- Spec-driven feature workflow (skills + `assemble_context`).
- PR quality enforcement (template + CI check).
- Ingestion pipeline (Lore Agent service on GKE).
- Observability (OpenTelemetry + Cloud Monitoring).
- Context evaluation (PromptFoo CI gate).
- Gap detection (automated drafting + PR opening).
- Live knowledge graph (PostgreSQL entities + edges).
- Intelligent memory lifecycle (passive capture, decay, consolidation).
- Autonomous review loop (opt-in per repo, webhook-driven per ADR-015).
- Progressive trust gating.
- Slack integration (`/lore` slash command + watcher notifications).
- Web UI (`/onboard`, pipeline status, task logs, analytics, knowledge graph, gaps, timeline, specs browser).
- Spec drift detection (Phase 2).
- Prompt caching on agent LLM calls (ADR-015).
- Per-template context budgets (ADR-015).
- Stuck-task terminal-state recovery (`stale_task_check` job).
- Dark Factory mode: per-repo human-gate opt-out, branch-as-state, declarative workflow graphs, lease-backed concurrency, auto-merge (ADR-016).
- Web UI theming: two-axis token model, per-family icon sets, FOUC-free provider (ADR-017).
- TDD methodology + per-subproject CI unit-test matrix (ADR-018).
- Cross-repo context linking with transfer scoring.
- Per-repo task-type overrides.
- PR outcome feedback (merge/rejection half-life adjustment).
- Production awareness (incidents surfaced in `assemble_context`).

### Out of Scope

- Chatbot or internal AI assistant product.
- Replacement for GitHub Issues, Jira, or project management tools.
- Documentation platform (indexes existing docs, does not replace).
- Surveillance tooling (opt-in only, no DMs).
- Custom agent orchestration frameworks — use native Claude Code Agent
  Teams for local work, Lore Agent for cluster work.
- Cross-team spec coordination beyond ADR patterns and pipeline task
  dependency links.
- OCI/crane-based Context Core bundles (superseded by DB-cached assembly).
- Graphiti / FalkorDB deployment (superseded by PostgreSQL live graph).
- Beads (`bd` CLI) or Dolt task sync (superseded by pipeline tasks).

## Dependencies

- Claude Code v2.1.32+ (Agent Teams support).
- GCP project with existing GKE cluster (`your-gke-cluster`,
  `europe-west1`) and Cloud Monitoring access (Phase 1+).
- CloudNativePG operator (CNPG) on GKE (Phase 1+, already installed
  on shared cluster).
- Vertex AI `text-embedding-005` for 768-dim embeddings (Phase 1+).
  Auth via Workload Identity — `lore-mcp-server` GCP SA with
  `aiplatform.user` role, bound to `default` SA in `mcp-servers`
  namespace. No API keys.
- GitHub organization with Actions, CODEOWNERS, PR template support,
  and GitHub App installation (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`).
- External Secrets Operator (ESO) pulling from GCP Secret Manager.
- PromptFoo (Phase 1+, stored in `evals/`).
- Anthropic API key (for Lore Agent, Phase 1+).
- Slack bot token (`LORE_SLACK_BOT_TOKEN`) for `/lore` slash command
  and watcher notifications (optional).
- `docker/claude-runner/` image for ephemeral Job pods.

## Assumptions

- Developers have Node.js, Python (with uv or pip), and Git installed.
- All product repos are on GitHub within the Acme organization.
- Teams are willing to adopt the PR description template.
- The platform engineering team serves as the Phase 0 pilot.
- Existing ADRs and team conventions can be written up in MADR
  format within Phase 0.
- GCP infrastructure provisioning is approved and budgeted for
  Phase 1.

## Success Criteria

1. A new developer goes from zero to a fully configured Claude Code
   environment in under 5 minutes with a single command.
2. Developers complete the full feature loop (constitution → spec
   → tasks → implementation → PR) without memorizing the sequence.
3. Claude Code correctly answers "why did we make this decision?"
   questions using ingested ADRs and PR history, without manual
   context loading.
4. 85% of context evaluation test cases pass on every merged PR
   that modifies context files.
5. Knowledge gaps are surfaced and drafted automatically within one
   week of first occurrence, with human review before merging.
6. Developer mental overhead is limited to three commands: task
   orientation, feature start, and PR drafting.
7. No long-lived credentials exist anywhere in the deployed system.
8. Pilot team (platform engineering) completes a full feature loop
   naturally before infrastructure investment begins.
