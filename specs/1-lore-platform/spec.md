# Feature Specification: Lore — Shared Context Infrastructure

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Lore Platform                              |
| Branch            | 1-lore-platform                            |
| Status            | Shipped                                    |
| Created           | 2026-03-25                                 |
| Updated           | 2026-04-20                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 3-4 working days                           |
| Full Stack Target | 6-8 weeks                                  |

> **Note (2026-04-13):** This spec has been updated to reflect the shipped
> implementation. Several technology choices changed after the initial spec:
> Beads + Dolt replaced by pipeline tasks in PostgreSQL (ADR-009), the
> purpose-built Lore Agent service deployed as the cluster agent runtime
> (ADR-007), Graphiti/FalkorDB replaced by a PostgreSQL-backed live knowledge
> graph (ADR-010), and OCI Context Cores replaced by DB-cached context
> assembly. All changes are documented in `adrs/`.

> **Note (2026-04-20):** Further updates to reflect ADR-015 (accepted
> 2026-04-17) and post-April-13 implementation work. Key changes: the
> review reactor is now webhook-driven (not cron-polled), prompt caching
> added to all agent LLM calls, per-template context budgets introduced
> (8K default, 16K for research), and additional MCP tools shipped. A
> stuck-task terminal-state recovery mechanism was also added. All changes
> are reflected in FR-13 and the new FR-16 and FR-17 below (the MCP tool
surface now lives in `specs/mcp-tools/`).

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
   `lore_create_pipeline_task`.
3. System creates a LoreTask CR; the Lore Agent schedules an
   ephemeral K8s Job pod that runs Claude Code with pre-loaded context.
4. Developer continues local work while the Job pod runs independently.
5. Developer checks status with `lore_get_pipeline_status` and retrieves
   results when ready. A GitHub Issue is automatically created and
   updated with task progress.

**Acceptance Criteria:**
- Task submission returns immediately with a tracking ID.
- Context bundle is pre-hydrated from the Lore API before the Job pod
  starts — the agent begins with conventions, ADRs, and memories.
- Developer can check task status and retrieve results without
  leaving Claude Code.
- The pipeline task is visible in the shared task tracker — no
  duplicate work. ([validated by `PipelineListView.test.tsx:149`](web-ui/src/app/pipeline/PipelineListView.test.tsx#L149))
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
- `lore_query_graph` returns multi-hop traversal results that vector
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
- FR-4.4: `lore_sync_tasks` MCP tool converts tasks.md task output into
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
  Configured via the settings UI or `lore.settings` table. ([validated by `SettingsView.test.tsx:84`](web-ui/src/app/settings/SettingsView.test.tsx#L84))

### FR-5: Spec-Driven Feature Workflow

The system MUST provide an end-to-end feature workflow via platform
skills.

- FR-5.1: `/lore-feature` skill guides the full loop: constitution
  generation → specification → task breakdown → pipeline task wiring.
- FR-5.2: `/lore-pr` skill drafts PR descriptions from spec, task
  context, and changed files.
- FR-5.3: Constitution generation calls `lore_assemble_context` to
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
- FR-8.4: `lore_my_usage` tool exposes per-developer token consumption
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
  every `lore_write_episode` call via the Lore Agent fact extractor.
- FR-11.2: Entity types: Service, Team, Function, PR, ADR, Spec,
  Concept, Runbook. Typed relationships: OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES.
- FR-11.3: `lore_query_graph(query)` MCP tool traverses the live graph
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
- FR-12.4: Every `lore_search_memory` call asynchronously increments
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
  Webhook-triggered runs are never gated by business hours. ([validated by `business-hours.test.ts:33`](agent/src/lib/business-hours.test.ts#L33))
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
- FR-17.2: The `lore_assemble_context` MCP tool's `max_tokens` parameter
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
- `lore_assemble_context` warns when repo context is stale (>7 days since
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
- Q: What happens when a Lore Agent Job pod fails mid-task? → A: Fail immediately, update pipeline task with error reason, post Slack notification if channel mapped. No automatic retry — developer decides whether to resubmit via `lore_retry_task`.
- Q: How does the PR check transition from warning to enforcement mode? → A: Manual flip by platform team via CI config flag. No automatic date-based cutoff.

### Session 2026-04-13 (spec update)

- Q: Why was Beads replaced? → A: Beads + Dolt had integration complexity and `bd` CLI instability. Pipeline tasks in PostgreSQL provide atomic claiming, dependency tracking, and full audit history without an external CLI dependency. (ADR-009)
- Q: How does the Lore Agent service run tasks? → A: A TypeScript worker in the `lore-agent` namespace polls the `pipeline.tasks` table and dispatches by task type. Simple tasks (onboard, feature-request, graph-ingest) run in-process via direct Anthropic API calls and the worker creates the PR. Complex tasks (implementation, general, review) run in ephemeral `claude-runner` Job pods created via the LoreTask CRD, with pre-run context hydration, deterministic validation, and full lifecycle control. (ADR-007)
- Q: Why no Graphiti / FalkorDB? → A: PostgreSQL-backed live knowledge graph provides the same traversable fact store without an additional graph database dependency. (ADR-010)
- Q: Why no OCI Context Cores? → A: DB-cached context assembly with the `lore_assemble_context` tool provides equivalent freshness guarantees without OCI registry infrastructure overhead. (ADR-010)

### Session 2026-04-20 (spec update — ADR-015 + post-April-13 work)

- Q: Why switch from cron-polling to webhooks for the review reactor? → A: Polling every 5 minutes burned API quota and GitHub rate-limit budget on ticks that did nothing. Webhooks fire only on actual PR state changes; review latency drops from avg ~2.5 min to seconds. (ADR-015)
- Q: Why keep the safety-net cron at all? → A: A dropped webhook delivery stalls a PR until a human notices. A business-hours safety cron is nearly free and catches stragglers. Off-hours ticks are a pure waste so the cron is gated by `isBusinessHours()`. (ADR-015)
- Q: Why was the context budget cut from 16K to 8K by default? → A: Implementation and review flows only need conventions + the immediate diff. 16K was over-sending context and paying unnecessary token costs. Research keeps 16K because it needs broad memory coverage. (ADR-015)
- Q: Why prompt-cache at the system + tool-schema boundary separately? → A: A tool-schema edit would otherwise bust the system-prompt cache entry. Separate breakpoints ensure each can be reused independently. (ADR-015)
- Q: What is the `LORE_WEBHOOK_SECRET` latent bug that ADR-015 fixed? → A: The secret existed in GCP Secret Manager and had an ExternalSecret CR, but was never mounted into the mcp-server pod. `handleGitHubWebhook` always returned `503 "webhook secret not configured"`. ADR-015 mounted the secret and the webhook path now validates HMAC signatures correctly.
- Q: Why add `FR-18` (stuck-task recovery) now? → A: Job pods that exit without writing a terminal status left tasks stuck in `running` forever. The loretask-watcher had no mechanism to detect this until the `stale_task_check` hourly job was added (commit f203952, 2026-04-20).

## Scope Boundaries

### In Scope

- Context repository structure and content.
- MCP server (file-backed Phase 0, PostgreSQL/pgvector-backed Phase 1+).
- Developer onboarding (install script, health check, settings merge).
- Task tracking integration (pipeline tasks + GitHub Issues + AGENTS.md + hooks).
- Spec-driven feature workflow (skills + `lore_assemble_context`).
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
- Web UI (`/onboard`, pipeline status, task logs, analytics, knowledge graph, gaps). ([validated by `GapsView.test.tsx:21`](web-ui/src/app/gaps/GapsView.test.tsx#L21), [`GraphView.test.tsx:31`](web-ui/src/app/graph/GraphView.test.tsx#L31), [`AnalyticsView.test.tsx:57`](web-ui/src/app/analytics/AnalyticsView.test.tsx#L57), [`TaskLogs.test.tsx:43`](web-ui/src/app/pipeline/[id]/TaskLogs.test.tsx#L43), [`OnboardView.test.tsx:8`](web-ui/src/app/onboard/OnboardView.test.tsx#L8))
- Spec drift detection (Phase 2).
- Prompt caching on agent LLM calls (ADR-015).
- Per-template context budgets (ADR-015).
- Stuck-task terminal-state recovery (`stale_task_check` job).

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
