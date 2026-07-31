# Feature Specification: Lore — Shared Context Infrastructure

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Lore Platform                              |
| Branch            | 1-lore-platform                            |
| Status            | In Progress                                |
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
  duplicate work. ([validated by `AssemblyLineRunListView.test.tsx:14`](apps/web-ui/src/app/assembly-lines/AssemblyLineRunListView.test.tsx#L14))
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
  `[DEPENDS ON: ...]` annotations. ([validated by `tasks.test.ts:60`](libs/shared/src/tasks.test.ts#L60))
- FR-4.5: Concurrent task claiming uses `SELECT ... FOR UPDATE SKIP
  LOCKED` — atomically prevents duplicate work without versioning
  overhead. A claim attempt on a taken task returns an immediate
  error; the developer or agent reads the ready list and picks
  another task. ([validated by `task-queue.test.ts:26`](libs/shared/src/project/tasks/task-queue.test.ts#L26))
- FR-4.6: Every pipeline task automatically creates a GitHub Issue
  on the target repo (labelled `lore-managed`). The issue receives
  status comments and is closed when the PR is created.
- FR-4.7: Optional approval gates: tasks can require a human to add
  an `approved` label on the GitHub Issue before processing.
  Configured via the settings UI or `lore.settings` table. ([validated by `SettingsView.test.tsx:123`](apps/web-ui/src/app/settings/SettingsView.test.tsx#L123))
- FR-4.8: `parseTasks` turns each `- [ ] Tnnn ...` markdown line into a task
  record — id, description, `completed` from the checkbox, `parallelizable` with a
  stripped description from a `[P]` marker, a `dependsOn` list from a `[DEPENDS ON: ...]`
  marker, a plain-or-backtick file path from the trailing ` | ` suffix, and the phase
  number carried from the preceding `## Phase N` header — defaulting phase to 0 and
  ignoring lines that are neither tasks nor phase headers. ([validated by `tasks.test.ts:25`](libs/shared/src/tasks.test.ts#L25), [`tasks.test.ts:39`](libs/shared/src/tasks.test.ts#L39), [`tasks.test.ts:46`](libs/shared/src/tasks.test.ts#L46), [`tasks.test.ts:53`](libs/shared/src/tasks.test.ts#L53), [`tasks.test.ts:69`](libs/shared/src/tasks.test.ts#L69), [`tasks.test.ts:85`](libs/shared/src/tasks.test.ts#L85), [`tasks.test.ts:101`](libs/shared/src/tasks.test.ts#L101), [`tasks.test.ts:23`](libs/server-core/src/features/pipeline/tasks.test.ts#L23), [`tasks.test.ts:31`](libs/server-core/src/features/pipeline/tasks.test.ts#L31), [`tasks.test.ts:39`](libs/server-core/src/features/pipeline/tasks.test.ts#L39), [`tasks.test.ts:47`](libs/server-core/src/features/pipeline/tasks.test.ts#L47), [`tasks.test.ts:54`](libs/server-core/src/features/pipeline/tasks.test.ts#L54), [`tasks.test.ts:73`](libs/server-core/src/features/pipeline/tasks.test.ts#L73), [`tasks.test.ts:92`](libs/server-core/src/features/pipeline/tasks.test.ts#L92))
- FR-4.9: `inferPhaseDependencies` derives dependency edges deterministically: a task
  depends on every task of the previous phase, sequential (non-`[P]`) tasks chain within a
  phase, `[P]` tasks stay free of intra-phase deps, explicit `[DEPENDS ON: ...]` deps are
  preserved rather than overwritten, and task lists with no phases (or empty input) are
  returned unchanged. ([validated by `tasks.test.ts:110`](libs/shared/src/tasks.test.ts#L110), [`tasks.test.ts:114`](libs/shared/src/tasks.test.ts#L114), [`tasks.test.ts:120`](libs/shared/src/tasks.test.ts#L120), [`tasks.test.ts:138`](libs/shared/src/tasks.test.ts#L138), [`tasks.test.ts:150`](libs/shared/src/tasks.test.ts#L150), [`tasks.test.ts:160`](libs/shared/src/tasks.test.ts#L160), [`tasks.test.ts:106`](libs/server-core/src/features/pipeline/tasks.test.ts#L106), [`tasks.test.ts:116`](libs/server-core/src/features/pipeline/tasks.test.ts#L116), [`tasks.test.ts:133`](libs/server-core/src/features/pipeline/tasks.test.ts#L133), [`tasks.test.ts:149`](libs/server-core/src/features/pipeline/tasks.test.ts#L149), [`tasks.test.ts:166`](libs/server-core/src/features/pipeline/tasks.test.ts#L166), [`tasks.test.ts:181`](libs/server-core/src/features/pipeline/tasks.test.ts#L181), [`tasks.test.ts:212`](libs/server-core/src/features/pipeline/tasks.test.ts#L212))
- FR-4.10: `specSlugFromBranch` extracts the spec slug from a
  `lore/feature-request/<slug>-<8hex>` branch by dropping the 8-hex task suffix, and returns
  null for a non-feature-request branch or one that has the prefix but no slug. ([validated by `tasks.test.ts:9`](libs/shared/src/tasks.test.ts#L9), [`tasks.test.ts:15`](libs/shared/src/tasks.test.ts#L15), [`tasks.test.ts:19`](libs/shared/src/tasks.test.ts#L19))

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
- FR-10.6: The per-repo `gap-detect` job skips repos that are not
  onboarded. ([validated by `gap-detect.test.ts:105`](libs/shared/src/detect/gap-detect.test.ts#L105))
- FR-10.7: It checks the repo's resolved-schema chunks for a CLAUDE.md
  doc chunk, ADR chunks, and spec chunks — filing a `gap-fill` task per
  missing kind, and none when all are present.
  ([validated by `gap-detect.test.ts:114`](libs/shared/src/detect/gap-detect.test.ts#L114), [`gap-detect.test.ts:123`](libs/shared/src/detect/gap-detect.test.ts#L123))
- FR-10.8: It files a stale-content `gap-fill` task only when more than
  10 reindex-owned chunks have gone unverified for over 90 days;
  api-ingested chunks never count toward the stale floor (semantics per
  the ADR-019 2026-07 verification-sweep amendment: a non-zero count
  means reindex has stopped covering the repo, not that files are
  unchanged).
  ([validated by `gap-detect.test.ts:135`](libs/shared/src/detect/gap-detect.test.ts#L135), [`gap-detect.test.ts:152`](libs/shared/src/detect/gap-detect.test.ts#L152), [`gap-detect.test.ts:163`](libs/shared/src/detect/gap-detect.test.ts#L163))
- FR-10.9: An in-flight or failed matching `gap-fill` task suppresses a
  duplicate filing. ([validated by `gap-detect.test.ts:175`](libs/shared/src/detect/gap-detect.test.ts#L175))

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
  invalidated facts older than 30 days beyond the 2000 cap. ([validated by `memory-ranking.test.ts:143`](libs/shared/src/memory-ranking.test.ts#L143))
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
  Webhook-triggered runs are never gated by business hours. ([validated by `business-hours.test.ts:38`](libs/shared/src/business-hours.test.ts#L38))
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
- FR-14.4: Spec-drift reads a repo's spec chunks and code symbols from
  the repo's resolved schema (team schema when provisioned, `org_shared`
  otherwise) — the same schema the reindex job wrote them to. The
  `codeSymbols` read excludes `symbol_type = 'call'` chunks, so a test
  file's `describe` title can never satisfy the drift heuristic's
  known-symbol check for a deleted declaration.
  ([validated by `chunks.test.ts:153`](libs/shared/src/project/chunks/chunks.test.ts#L153), [`chunks.test.ts:171`](libs/shared/src/project/chunks/chunks.test.ts#L171), [`chunks.test.ts:190`](libs/shared/src/project/chunks/chunks.test.ts#L190), [`chunks.test.ts:212`](libs/shared/src/project/chunks/chunks.test.ts#L212), [`chunks.test.ts:887`](libs/shared/src/project/chunks/chunks.test.ts#L887), [`chunks.test.ts:920`](libs/shared/src/project/chunks/chunks.test.ts#L920))

### FR-15: Progressive Trust (Phase 1)

The system MUST gate task types per-repo based on demonstrated
reliability.

- FR-15.1: `settings.trust.level` controls which task types are
  allowed: `docs` (gap-fill/runbook/onboard + feature-planning/
  feature-finalize per ADR-027), `tests` (+review),
  `implementation` (+implementation/feature-request/general),
  `full` (all). `onboard` is allowed at every tier — it produces a
  docs-only scaffolding PR and duplicate protection lives in its own
  route's guard, not the trust ladder. ([validated by `allows an onboard task at trust level %s`](libs/shared/src/pipeline-tasks.trust.test.ts#L37), [`still refuses an implementation task at trust level docs`](libs/shared/src/pipeline-tasks.trust.test.ts#L52))
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
  disables 1h everywhere; `*` enables it for every job. ([validated by `prompt-cache.test.ts:93`](libs/shared/src/llm/prompt-cache.test.ts#L93))
- FR-16.3: Cache eligibility is latched at module load to prevent
  mid-process toggles from busting the server-side cache.
- FR-16.4: Each call computes a djb2 hash of the system + tools prefix
  and compares to the last call for the same `jobName`. Log line
  emits: `cache hit | first-call | break:system | break:tools |
  break:ttl(Nm)`. ([validated by `prompt-cache.test.ts:123`](libs/shared/src/llm/prompt-cache.test.ts#L123), [`prompt-cache.test.ts:129`](libs/shared/src/llm/prompt-cache.test.ts#L129))
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
  configured timeout plus a grace period. ([validated by `task-queue.test.ts:365`](libs/shared/src/project/tasks/task-queue.test.ts#L365))
- FR-18.2: Stuck tasks are transitioned to a terminal state
  (`failed` with reason `timeout_exceeded`) so the pipeline does not
  stall waiting for a pod that has already exited.
- FR-18.3: The transition is idempotent — if a task completes between
  detection and the state write, the write is a no-op.
- FR-18.4: A failure episode is written for each stuck task so the
  auto-curation pipeline can surface patterns (e.g. a task type that
  consistently times out).

### FR-19: Task Detail UI (Phase 1)

The web UI MUST present a per-task detail view at `/tasks/[id]` that
surfaces the task's metadata, run attempts, stage timeline, PR status,
event history, and LLM-call ledger. Live sections follow a
data-down/actions-up split: pure `*View` presentational components are
fed by IO `*Panel` containers that own fetching and polling.

- FR-19.1: The detail heading reads `Task: <description>` with the
  description truncated to 80 characters, and the view shows the task
  type, target repo, creator, and a sentence-cased status badge.
  Priority renders as a red badge when `immediate` and falls back to a
  plain `normal` meta label when empty. ([validated by `TaskDetailView.test.tsx:95`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L95), [`TaskDetailView.test.tsx:114`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L114), [`TaskDetailView.test.tsx:122`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L122), [`TaskDetailView.test.tsx:134`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L134), [`TaskDetailView.test.tsx:141`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L141))
- FR-19.2: The agent row, failure row, and review-iterations row each
  render only when their value is present (agent assigned, failure
  reason set, review iteration greater than zero) and are omitted
  otherwise. ([validated by `TaskDetailView.test.tsx:195`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L195), [`TaskDetailView.test.tsx:201`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L201), [`TaskDetailView.test.tsx:223`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L223), [`TaskDetailView.test.tsx:229`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L229), [`TaskDetailView.test.tsx:235`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L235))
- FR-19.3: The view lists the task's run attempts under a "Runs"
  heading, each linking to its run detail at `/assembly-lines/<run-id>`,
  and omits the section entirely when the task has no runs. ([validated by `TaskDetailView.test.tsx:66`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L66), [`TaskDetailView.test.tsx:87`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L87))
- FR-19.4: In-flight controls follow actions-up: a "Run Now" form
  posting to `/api/tasks/<id>/run-now` appears only for pending
  normal-priority tasks; a "Cancel Task" control appears for
  non-terminal tasks and is hidden once merged or completed; the
  confirm-gated `CancelTaskButton` shows only its trigger until clicked,
  then reveals a form posting to `/api/tasks/<id>/cancel` that "Keep
  task" backs out of; and a "Give Feedback" form wired to the injected
  server action (with a hidden `task_id`) shows only for a task that has
  a PR and is not cancelled. ([validated by `TaskDetailView.test.tsx:148`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L148), [`TaskDetailView.test.tsx:159`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L159), [`TaskDetailView.test.tsx:166`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L166), [`TaskDetailView.test.tsx:175`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L175), [`TaskDetailView.test.tsx:188`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L188), [`TaskDetailView.test.tsx:264`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L264), [`TaskDetailView.test.tsx:285`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L285), [`TaskDetailView.test.tsx:292`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L292), [`CancelTaskButton.test.tsx:7`](apps/web-ui/src/app/tasks/[id]/CancelTaskButton.test.tsx#L7), [`CancelTaskButton.test.tsx:17`](apps/web-ui/src/app/tasks/[id]/CancelTaskButton.test.tsx#L17), [`CancelTaskButton.test.tsx:30`](apps/web-ui/src/app/tasks/[id]/CancelTaskButton.test.tsx#L30))
- FR-19.5: When a failed task carries a failed-event with metadata, the
  view renders a "Failure" panel surfacing the error; absent that
  metadata no panel is shown. ([validated by `TaskDetailView.test.tsx:240`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L240), [`TaskDetailView.test.tsx:257`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L257))
- FR-19.6: The event timeline renders one badge per status transition
  (sentence-cased to-status with a from-status arrow), pretty-prints
  event metadata as JSON, and shows an empty-state note when there are
  no events. ([validated by `TaskDetailView.test.tsx:305`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L305), [`EventTimeline.test.tsx:17`](apps/web-ui/src/app/tasks/[id]/EventTimeline.test.tsx#L17), [`EventTimeline.test.tsx:28`](apps/web-ui/src/app/tasks/[id]/EventTimeline.test.tsx#L28), [`EventTimeline.test.tsx:36`](apps/web-ui/src/app/tasks/[id]/EventTimeline.test.tsx#L36))
- FR-19.7: The LLM-calls table renders one row per call with the model,
  `input / output` token counts, duration, and a status badge (red with
  the error text on failure), and shows an empty-state note in place of
  the table when there are none. ([validated by `TaskDetailView.test.tsx:333`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L333), [`TaskDetailView.test.tsx:351`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L351), [`TaskDetailView.test.tsx:365`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L365), [`LlmCallsTable.test.tsx:19`](apps/web-ui/src/app/tasks/[id]/LlmCallsTable.test.tsx#L19), [`LlmCallsTable.test.tsx:27`](apps/web-ui/src/app/tasks/[id]/LlmCallsTable.test.tsx#L27), [`LlmCallsTable.test.tsx:35`](apps/web-ui/src/app/tasks/[id]/LlmCallsTable.test.tsx#L35))
- FR-19.8: The pure stage-timeline view renders loading, error
  (`Timeline unavailable: <reason>`), and empty (nothing rendered)
  states from its props, shows "No stage commits yet." when the branch
  exists but has no commits, renders a `no_branch` pending notice and a
  branch-deleted banner that suppresses the empty-commits message, and
  for each commit shows a node icon (bullet fallback for unknown
  stages), an outcome pill coloured by outcome (success /
  changes_requested / failed with a muted fallback), a formatted
  duration (null / ms / seconds / minutes), a GitHub commit link
  omitted when the repo is null, and a held-lease indicator naming the
  holder and its expiry (expiry omitted when absent, hidden when the
  lease is not held). ([validated by `TimelineView.test.tsx:45`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L45), [`TimelineView.test.tsx:51`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L51), [`TimelineView.test.tsx:59`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L59), [`TimelineView.test.tsx:67`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L67), [`TimelineView.test.tsx:74`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L74), [`TimelineView.test.tsx:88`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L88), [`TimelineView.test.tsx:123`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L123), [`TimelineView.test.tsx:139`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L139), [`TimelineView.test.tsx:169`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L169), [`TimelineView.test.tsx:191`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L191), [`TimelineView.test.tsx:212`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L212), [`TimelineView.test.tsx:224`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L224), [`TimelineView.test.tsx:244`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L244), [`TimelineView.test.tsx:257`](apps/web-ui/src/app/tasks/[id]/TimelineView.test.tsx#L257))
- FR-19.9: The timeline container fetches `/api/tasks/<id>/timeline`,
  rendering loading, error (non-ok response or rejected fetch), and
  resolved states, clears a prior error after a later successful poll,
  polls on a 10-second interval while the task is active (driven by
  `initialStatus` or a still-active `current_stage`), does not poll for
  a terminal status whose stage is `retrospective`, and stops fetching
  after unmount. ([validated by `TimelinePanel.test.tsx:70`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L70), [`TimelinePanel.test.tsx:91`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L91), [`TimelinePanel.test.tsx:101`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L101), [`TimelinePanel.test.tsx:111`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L111), [`TimelinePanel.test.tsx:124`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L124), [`TimelinePanel.test.tsx:136`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L136), [`TimelinePanel.test.tsx:156`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L156), [`TimelinePanel.test.tsx:181`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L181), [`TimelinePanel.test.tsx:199`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L199), [`TimelinePanel.test.tsx:222`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L222))
- FR-19.10: The pure PR status card shows a loading placeholder until
  details arrive, an "unavailable" fallback with a "View on GitHub" link
  when only an error is present, keeps the loaded details on screen even
  when a later error arrives, renders the computed-status pill (mapped
  colour, muted fallback for an unknown status) with a PR link, omits
  the checks row when there are no checks and otherwise counts passing
  (success / skipped), failing (failure / timed_out), and pending (any
  non-completed) checks — showing no counts when every check is
  zero-bucketed — and lists approvers and change-requesters (or both),
  omitting the reviews row when there are neither. ([validated by `PRStatusCard.test.tsx:44`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L44), [`PRStatusCard.test.tsx:53`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L53), [`PRStatusCard.test.tsx:70`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L70), [`PRStatusCard.test.tsx:83`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L83), [`PRStatusCard.test.tsx:106`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L106), [`PRStatusCard.test.tsx:120`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L120), [`PRStatusCard.test.tsx:136`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L136), [`PRStatusCard.test.tsx:148`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L148), [`PRStatusCard.test.tsx:169`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L169), [`PRStatusCard.test.tsx:188`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L188), [`PRStatusCard.test.tsx:205`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L205), [`PRStatusCard.test.tsx:225`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L225), [`PRStatusCard.test.tsx:242`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L242), [`PRStatusCard.test.tsx:254`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L254), [`PRStatusCard.test.tsx:288`](apps/web-ui/src/app/tasks/[id]/PRStatusCard.test.tsx#L288))
- FR-19.11: The PR status container fetches `/api/tasks/<id>/pr-status`
  and renders the card, surfaces the unavailable fallback on an error
  payload or a rejected fetch, refetches when the task id changes, does
  not fetch after unmount, keeps the loaded details when a later poll
  fails, and stops polling after a failed poll. ([validated by `PRStatusPanel.test.tsx:60`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L60), [`PRStatusPanel.test.tsx:70`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L70), [`PRStatusPanel.test.tsx:83`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L83), [`PRStatusPanel.test.tsx:99`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L99), [`PRStatusPanel.test.tsx:115`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L115), [`PRStatusPanel.test.tsx:133`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L133), [`PRStatusPanel.test.tsx:158`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L158))

### FR-20: Project Facade Ports (Phase 1)

The `Project` facade (ADR-024) exposes every data capability — tasks,
events, chunks, features, agents, workspace, PRs, issues, cost/usage
accounting — through repo-bound ports with a Postgres/GCS/HTTP adapter
and an in-memory double per port, so Floor, mcp-server, and lore-api
share one persistence surface instead of inline SQL.

- FR-20.1: The `TaskQueue` port drives org-wide claim/sweep: it claims
  one runnable pending task (immediate-first, past the minute interval,
  without the dead `running-local` predicate) or null, CAS-updates a
  still-pending row to a claimer (default or caller-supplied) and returns
  false when already claimed, stays org-wide with no params but scopes to
  a repo when given, flips a running task to completed (reporting
  same-spec dependents it unblocks, false for unknown/non-running), and
  exposes `awaitingApproval`, `distinctTargetRepos`, `prInfo`, and
  `findRecoverable`. ([validated by `task-queue.test.ts:39`](libs/shared/src/project/tasks/task-queue.test.ts#L39), [`task-queue.test.ts:46`](libs/shared/src/project/tasks/task-queue.test.ts#L46), [`task-queue.test.ts:54`](libs/shared/src/project/tasks/task-queue.test.ts#L54), [`task-queue.test.ts:68`](libs/shared/src/project/tasks/task-queue.test.ts#L68), [`task-queue.test.ts:77`](libs/shared/src/project/tasks/task-queue.test.ts#L77), [`task-queue.test.ts:86`](libs/shared/src/project/tasks/task-queue.test.ts#L86), [`task-queue.test.ts:94`](libs/shared/src/project/tasks/task-queue.test.ts#L94), [`task-queue.test.ts:102`](libs/shared/src/project/tasks/task-queue.test.ts#L102), [`task-queue.test.ts:112`](libs/shared/src/project/tasks/task-queue.test.ts#L112), [`task-queue.test.ts:121`](libs/shared/src/project/tasks/task-queue.test.ts#L121), [`task-queue.test.ts:132`](libs/shared/src/project/tasks/task-queue.test.ts#L132), [`task-queue.test.ts:146`](libs/shared/src/project/tasks/task-queue.test.ts#L146), [`task-queue.test.ts:199`](libs/shared/src/project/tasks/task-queue.test.ts#L199), [`task-queue.test.ts:210`](libs/shared/src/project/tasks/task-queue.test.ts#L210), [`task-queue.test.ts:223`](libs/shared/src/project/tasks/task-queue.test.ts#L223), [`task-queue.test.ts:237`](libs/shared/src/project/tasks/task-queue.test.ts#L237), [`task-queue.test.ts:295`](libs/shared/src/project/tasks/task-queue.test.ts#L295), [`task-queue.test.ts:305`](libs/shared/src/project/tasks/task-queue.test.ts#L305), [`task-queue.test.ts:334`](libs/shared/src/project/tasks/task-queue.test.ts#L334))
- FR-20.1a: The `pipeline.tasks` queue, exercised end-to-end against Postgres,
  backs those port behaviors: a created task defaults to `pending` status and
  `normal` priority (accepting an explicit `immediate`); a claim is atomic (a
  second claim of the same row takes nothing); the claim query applies a 30s
  grace window that excludes just-created tasks yet lets an `immediate` task
  through without the grace; a task walks `pending → running → completed`,
  recording a transition event per step for the audit trail and a
  `failure_reason` on failure; the review loop increments `review_iteration`;
  and run-now flips a pending task's priority from `normal` to `immediate`.
  ([validated by `creates a task in pending status`](apps/lore-api/src/integration-tests/pipeline.test.ts#L30), [validated by `claims a task atomically`](apps/lore-api/src/integration-tests/pipeline.test.ts#L40), [validated by `30s grace period excludes recently created tasks`](apps/lore-api/src/integration-tests/pipeline.test.ts#L71), [validated by `full lifecycle pending running completed`](apps/lore-api/src/integration-tests/pipeline.test.ts#L91), [validated by `records task events for audit trail`](apps/lore-api/src/integration-tests/pipeline.test.ts#L123), [validated by `handles failure with reason`](apps/lore-api/src/integration-tests/pipeline.test.ts#L154), [validated by `tracks review iterations`](apps/lore-api/src/integration-tests/pipeline.test.ts#L176), [validated by `creates tasks with default priority normal`](apps/lore-api/src/integration-tests/pipeline.test.ts#L198), [validated by `creates tasks with explicit priority immediate`](apps/lore-api/src/integration-tests/pipeline.test.ts#L208), [validated by `GKE worker query picks up immediate tasks without grace`](apps/lore-api/src/integration-tests/pipeline.test.ts#L218), [validated by `run-now updates priority from normal to immediate`](apps/lore-api/src/integration-tests/pipeline.test.ts#L241))
- FR-20.2: The `TaskQueue` port also drives spec-task DAG dispatch: it
  claims a pending spec-task once via CAS (default claimer
  `spec-task-executor`), completes it reporting only the same-spec
  dependents it unblocks (false when not running), exposes
  `awaitingApproval`/`distinctTargetRepos`/`prInfo`, and returns ready
  spec-tasks whose deps are completed/merged in the same spec — scoping
  the returned set to one repo while still resolving deps org-wide.
  ([validated by `task-queue.test.ts:389`](libs/shared/src/project/tasks/task-queue.test.ts#L389), [`task-queue.test.ts:398`](libs/shared/src/project/tasks/task-queue.test.ts#L398), [`task-queue.test.ts:413`](libs/shared/src/project/tasks/task-queue.test.ts#L413), [`task-queue.test.ts:428`](libs/shared/src/project/tasks/task-queue.test.ts#L428), [`task-queue.test.ts:470`](libs/shared/src/project/tasks/task-queue.test.ts#L470), [`task-queue.test.ts:492`](libs/shared/src/project/tasks/task-queue.test.ts#L492), [`task-queue.test.ts:502`](libs/shared/src/project/tasks/task-queue.test.ts#L502), [`task-queue.test.ts:517`](libs/shared/src/project/tasks/task-queue.test.ts#L517), [`task-queue.test.ts:553`](libs/shared/src/project/tasks/task-queue.test.ts#L553))
- FR-20.3: The repo-scoped `TaskStore` port queries pending statuses,
  transitions a cancel to `cancelled`, writes `setStatus` (status +
  updated_at + only allowlisted extra columns), reads-old-then-writes-new
  status recording the transition event on `updateStatus`, and filters
  `findOpenLike` by repo, type, description prefix, and given statuses —
  each bound to the facade's repo. ([validated by `task-store-pg.test.ts:29`](libs/shared/src/project/tasks/task-store-pg.test.ts#L29), [`task-store-pg.test.ts:44`](libs/shared/src/project/tasks/task-store-pg.test.ts#L44), [`task-store-pg.test.ts:57`](libs/shared/src/project/tasks/task-store-pg.test.ts#L57), [`task-store-pg.test.ts:74`](libs/shared/src/project/tasks/task-store-pg.test.ts#L74), [`task-store-pg.test.ts:88`](libs/shared/src/project/tasks/task-store-pg.test.ts#L88))
- FR-20.4: The task-list surface returns the repo's pending tasks as
  typed `Task` wrappers and reflects the new status after `cancel()`.
  ([validated by `task-list.test.ts:101`](libs/shared/src/project/tasks/task-list.test.ts#L101), [`task-list.test.ts:118`](libs/shared/src/project/tasks/task-list.test.ts#L118))
- FR-20.5: The `EventQueue` port claims runnable rows with `FOR UPDATE
  SKIP LOCKED` incrementing attempts (oldest-first, flipping to
  processing), collapses a redelivery sharing a dedupe key, truncates the
  error and applies the backoff on `markFailed` (a failed row becomes
  claimable only after the backoff elapses), resets timed-out processing
  rows to failed on `reapStuck`, and prunes handled/terminal rows past
  the window — returning affected-row counts. ([validated by `event-queue.test.ts:25`](libs/shared/src/project/events/event-queue.test.ts#L25), [`event-queue.test.ts:50`](libs/shared/src/project/events/event-queue.test.ts#L50), [`event-queue.test.ts:59`](libs/shared/src/project/events/event-queue.test.ts#L59), [`event-queue.test.ts:66`](libs/shared/src/project/events/event-queue.test.ts#L66), [`event-queue.test.ts:80`](libs/shared/src/project/events/event-queue.test.ts#L80), [`event-queue.test.ts:99`](libs/shared/src/project/events/event-queue.test.ts#L99), [`event-queue.test.ts:139`](libs/shared/src/project/events/event-queue.test.ts#L139), [`event-queue.test.ts:154`](libs/shared/src/project/events/event-queue.test.ts#L154), [`event-queue.test.ts:176`](libs/shared/src/project/events/event-queue.test.ts#L176))
- FR-20.6: The `Chunks` knowledge-store port checks schema existence via
  `information_schema`, counts/inserts/deletes chunks within an
  interpolated (injection-rejecting) schema, sets the caller-formatted
  embedding vector, resolves the repo's team schema (falling back to
  `org_shared`) for the spec-chunk and code-symbol reads, for
  chunk-existence checks, and for the stale count —
  which covers only reindex-owned rows (`ingested_by = 'reindex-job'`)
  so the nightly verification pass can clear it — and for the coverage
  spec-chunk reads (with and without embeddings) ordered by `file_path` then
  `metadata.chunk_index` nulls-last then `ingested_at` so multi-chunk
  specs reassemble in document order — lists, re-stamps (whole files
  at a time to a single `NOW()`, gated to files whose oldest chunk is
  past a caller-supplied age floor so steady-state nights rewrite
  nothing), and prunes reindex-owned chunks by file path for
  that pass, and returns distinct teams with per-team `org_shared`
  counts (defaulting a missing count to zero).
  ([validated by `chunks.test.ts:42`](libs/shared/src/project/chunks/chunks.test.ts#L42), [`chunks.test.ts:50`](libs/shared/src/project/chunks/chunks.test.ts#L50), [`chunks.test.ts:56`](libs/shared/src/project/chunks/chunks.test.ts#L56), [`chunks.test.ts:66`](libs/shared/src/project/chunks/chunks.test.ts#L66), [`chunks.test.ts:81`](libs/shared/src/project/chunks/chunks.test.ts#L81), [`chunks.test.ts:98`](libs/shared/src/project/chunks/chunks.test.ts#L98), [`chunks.test.ts:106`](libs/shared/src/project/chunks/chunks.test.ts#L106), [`chunks.test.ts:117`](libs/shared/src/project/chunks/chunks.test.ts#L117), [`chunks.test.ts:131`](libs/shared/src/project/chunks/chunks.test.ts#L131), [`chunks.test.ts:139`](libs/shared/src/project/chunks/chunks.test.ts#L139), [`chunks.test.ts:145`](libs/shared/src/project/chunks/chunks.test.ts#L145), [`chunks.test.ts:153`](libs/shared/src/project/chunks/chunks.test.ts#L153), [`chunks.test.ts:171`](libs/shared/src/project/chunks/chunks.test.ts#L171), [`chunks.test.ts:190`](libs/shared/src/project/chunks/chunks.test.ts#L190), [`chunks.test.ts:212`](libs/shared/src/project/chunks/chunks.test.ts#L212), [`chunks.test.ts:235`](libs/shared/src/project/chunks/chunks.test.ts#L235), [`chunks.test.ts:249`](libs/shared/src/project/chunks/chunks.test.ts#L249), [`chunks.test.ts:257`](libs/shared/src/project/chunks/chunks.test.ts#L257), [`chunks.test.ts:271`](libs/shared/src/project/chunks/chunks.test.ts#L271), [`chunks.test.ts:278`](libs/shared/src/project/chunks/chunks.test.ts#L278), [`chunks.test.ts:295`](libs/shared/src/project/chunks/chunks.test.ts#L295), [`chunks.test.ts:318`](libs/shared/src/project/chunks/chunks.test.ts#L318), [`chunks.test.ts:362`](libs/shared/src/project/chunks/chunks.test.ts#L362), [`chunks.test.ts:394`](libs/shared/src/project/chunks/chunks.test.ts#L394), [`chunks.test.ts:411`](libs/shared/src/project/chunks/chunks.test.ts#L411), [`chunks.test.ts:426`](libs/shared/src/project/chunks/chunks.test.ts#L426), [`chunks.test.ts:437`](libs/shared/src/project/chunks/chunks.test.ts#L437), [`chunks.test.ts:452`](libs/shared/src/project/chunks/chunks.test.ts#L452), [`chunks.test.ts:461`](libs/shared/src/project/chunks/chunks.test.ts#L461), [`chunks.test.ts:468`](libs/shared/src/project/chunks/chunks.test.ts#L468), [`chunks.test.ts:490`](libs/shared/src/project/chunks/chunks.test.ts#L490), [`chunks.test.ts:498`](libs/shared/src/project/chunks/chunks.test.ts#L498), [`chunks.test.ts:527`](libs/shared/src/project/chunks/chunks.test.ts#L527), [`chunks.test.ts:541`](libs/shared/src/project/chunks/chunks.test.ts#L541), [`chunks.test.ts:577`](libs/shared/src/project/chunks/chunks.test.ts#L577), [`chunks.test.ts:596`](libs/shared/src/project/chunks/chunks.test.ts#L596))
- FR-20.7: The HTTP `Chunks` adapter reads spec chunks (and backfill
  chunks with embeddings) from the repo-scoped API with a bearer token,
  maps `hasChunk`/`staleChunkCount` to their query endpoints, and throws
  on a non-ok response and on the Floor-only write surface. ([validated by `chunks-http.test.ts:28`](libs/shared/src/project/chunks/chunks-http.test.ts#L28), [`chunks-http.test.ts:43`](libs/shared/src/project/chunks/chunks-http.test.ts#L43), [`chunks-http.test.ts:60`](libs/shared/src/project/chunks/chunks-http.test.ts#L60), [`chunks-http.test.ts:94`](libs/shared/src/project/chunks/chunks-http.test.ts#L94))
- FR-20.8: The `Features` store persists feature planning bound to its
  repo: it lists by repo ordered by `updated_at` (with an optional status
  filter), attaches a `task_id` to an iteration, updates an iteration's
  `gap_result`/status, sets status alone or alongside a column patch, and
  deletes a feature scoped to its repo (returning whether a row was
  removed); the facade stamps the bound repo on every call, and the pure
  helpers gate finalizing to a settled planning state and return the gap
  of the highest-numbered ready iteration (null when none). ([validated by `features-pg.test.ts:48`](libs/shared/src/project/features/features-pg.test.ts#L48), [`features-pg.test.ts:58`](libs/shared/src/project/features/features-pg.test.ts#L58), [`features-pg.test.ts:95`](libs/shared/src/project/features/features-pg.test.ts#L95), [`features-pg.test.ts:112`](libs/shared/src/project/features/features-pg.test.ts#L112), [`features-pg.test.ts:139`](libs/shared/src/project/features/features-pg.test.ts#L139), [`features-pg.test.ts:148`](libs/shared/src/project/features/features-pg.test.ts#L148), [`features-pg.test.ts:168`](libs/shared/src/project/features/features-pg.test.ts#L168), [`features-pg.test.ts:178`](libs/shared/src/project/features/features-pg.test.ts#L178), [`features.test.ts:45`](libs/shared/src/project/features/features.test.ts#L45), [`features.test.ts:52`](libs/shared/src/project/features/features.test.ts#L52), [`features.test.ts:62`](libs/shared/src/project/features/features.test.ts#L62), [`features.test.ts:72`](libs/shared/src/project/features/features.test.ts#L72), [`features-port.test.ts:28`](libs/shared/src/project/features/features-port.test.ts#L28), [`features-port.test.ts:34`](libs/shared/src/project/features/features-port.test.ts#L34), [`features-port.test.ts:48`](libs/shared/src/project/features/features-port.test.ts#L48), [`features-port.test.ts:58`](libs/shared/src/project/features/features-port.test.ts#L58), [`features-port.test.ts:68`](libs/shared/src/project/features/features-port.test.ts#L68))
- FR-20.9: Feature planning recovery orphans a running round older than
  the window (even while the runtime reports active), leaves a recent
  active round alone, no-ops when a ready round already moved the feature
  out of `planning` or there are no iterations, and keys on the latest
  iteration so a newer ready round supersedes an older running one; the
  round-in-flight helper returns a recent running iteration and null when
  the only running one is orphaned or none is running. ([validated by `planning-recovery.test.ts:48`](libs/shared/src/project/features/planning-recovery.test.ts#L48), [`planning-recovery.test.ts:67`](libs/shared/src/project/features/planning-recovery.test.ts#L67), [`planning-recovery.test.ts:97`](libs/shared/src/project/features/planning-recovery.test.ts#L97), [`planning-recovery.test.ts:110`](libs/shared/src/project/features/planning-recovery.test.ts#L110), [`planning-recovery.test.ts:130`](libs/shared/src/project/features/planning-recovery.test.ts#L130), [`round-in-flight.test.ts:26`](libs/shared/src/project/features/round-in-flight.test.ts#L26), [`round-in-flight.test.ts:38`](libs/shared/src/project/features/round-in-flight.test.ts#L38), [`round-in-flight.test.ts:48`](libs/shared/src/project/features/round-in-flight.test.ts#L48))
- FR-20.10: The `AgentRunner` port launches a Station via the injected
  `StationBackend` in cluster mode (passing the execution image, throwing
  when no provider is supplied) and calls the injected `LlmPort` in
  direct mode; agent execution refuses LOCAL mode on the shared server
  (`LORE_DB_HOST` set) yet allows cluster mode there. ([validated by `agent-runner.test.ts:33`](libs/shared/src/project/agents/agent-runner.test.ts#L33), [`agent-runner.test.ts:15`](libs/shared/src/project/agents/agent-runner.test.ts#L15), [`agent-runner.test.ts:70`](libs/shared/src/project/agents/agent-runner.test.ts#L70), [`agent-runner.test.ts:90`](libs/shared/src/project/agents/agent-runner.test.ts#L90), [`agent-runner.test.ts:114`](libs/shared/src/project/agents/agent-runner.test.ts#L114), [`agents.test.ts:22`](libs/shared/src/project/agents/agents.test.ts#L22), [`agents.test.ts:34`](libs/shared/src/project/agents/agents.test.ts#L34))
- FR-20.11: The station-mode selector honours explicit `k8s`/`docker`
  overrides and the `inprocess` escape hatch, defaults to `k8s`
  in-cluster and `docker` off-cluster, and ignores an unrecognized value
  falling back to context. ([validated by `station-port.test.ts:5`](libs/shared/src/project/agents/station-port.test.ts#L5), [`station-port.test.ts:9`](libs/shared/src/project/agents/station-port.test.ts#L9), [`station-port.test.ts:18`](libs/shared/src/project/agents/station-port.test.ts#L18), [`station-port.test.ts:24`](libs/shared/src/project/agents/station-port.test.ts#L24), [`station-port.test.ts:30`](libs/shared/src/project/agents/station-port.test.ts#L30), [`station-port.test.ts:34`](libs/shared/src/project/agents/station-port.test.ts#L34))
- FR-20.12: The `AgentDefs` port resolves an agent definition through
  three layers (yaml base → org row → project row), inheriting nullable
  fields upward and letting each higher layer override, returning null
  when every layer is null; the Pg adapter binds the name and repo,
  qualifies the `lore.repos` JOIN columns, and creates/deletes the repo's
  project row scoped to the repo; the yaml base resolves task types
  (mapping zero-LLM ingest types with graph-ingest mode), lists agents
  sorted by name, serves `DECOMPOSITION_INSTRUCTIONS` for
  `feature-decompose`, and returns null for an unknown name; the facade
  lists and delegates create/delete with the bound repo; and the HTTP
  adapter resolves/lists via the bearer-authed API (null on 404).
  ([validated by `agent-defs-port.test.ts:23`](libs/shared/src/project/agents/agent-defs-port.test.ts#L23), [`agent-defs-port.test.ts:27`](libs/shared/src/project/agents/agent-defs-port.test.ts#L27), [`agent-defs-port.test.ts:31`](libs/shared/src/project/agents/agent-defs-port.test.ts#L31), [`agent-defs-port.test.ts:67`](libs/shared/src/project/agents/agent-defs-port.test.ts#L67), [`agent-defs-pg.test.ts:101`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L101), [`agent-defs-pg.test.ts:110`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L110), [`agent-defs-pg.test.ts:122`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L122), [`agent-defs-pg.test.ts:138`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L138), [`agent-defs-pg.test.ts:165`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L165), [`agent-defs-yaml.test.ts:43`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L43), [`agent-defs-yaml.test.ts:58`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L58), [`agent-defs-yaml.test.ts:68`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L68), [`agent-defs-yaml.test.ts:77`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L77), [`agent-defs-yaml.test.ts:109`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L109), [`agent-defs.test.ts:60`](libs/shared/src/project/agents/agent-defs.test.ts#L60), [`agent-defs.test.ts:68`](libs/shared/src/project/agents/agent-defs.test.ts#L68), [`agent-defs-http.test.ts:55`](libs/shared/src/project/agents/agent-defs-http.test.ts#L55), [`agent-defs-http.test.ts:64`](libs/shared/src/project/agents/agent-defs-http.test.ts#L64), [`agent-defs-http.test.ts:70`](libs/shared/src/project/agents/agent-defs-http.test.ts#L70))
- FR-20.13: The `Workspace`/`Git` ports carry the installation token as a
  base64 `x-access-token` `http.extraheader` override (honouring a
  non-default host, never embedding the raw token in the args or
  `.git/config`) and build a credential-free https URL when tokenless;
  the git CLI clones and reads a seeded file, writes/commits on a new
  branch and pushes (falling back to the Lore Agent identity), and
  `ensureClone`/`ensureCheckout` cache-reuse via fetch, pin the branch,
  and refuse to switch a dirty tree; the workspace facade writes-then-
  reads a file committing through the GitPort and pushes then opens the
  PR via the pulls port. ([validated by `git-auth.test.ts:5`](libs/shared/src/project/workspace/git-auth.test.ts#L5), [`git-auth.test.ts:14`](libs/shared/src/project/workspace/git-auth.test.ts#L14), [`git-auth.test.ts:20`](libs/shared/src/project/workspace/git-auth.test.ts#L20), [`git-auth.test.ts:26`](libs/shared/src/project/workspace/git-auth.test.ts#L26), [`git-cli-auth.test.ts:22`](libs/shared/src/project/workspace/git-cli-auth.test.ts#L22), [`git-cli-auth.test.ts:35`](libs/shared/src/project/workspace/git-cli-auth.test.ts#L35), [`git-cli-auth.test.ts:46`](libs/shared/src/project/workspace/git-cli-auth.test.ts#L46), [`git-cli.test.ts:53`](libs/shared/src/project/workspace/git-cli.test.ts#L53), [`git-cli.test.ts:63`](libs/shared/src/project/workspace/git-cli.test.ts#L63), [`git-cli.test.ts:81`](libs/shared/src/project/workspace/git-cli.test.ts#L81), [`git-cli.test.ts:100`](libs/shared/src/project/workspace/git-cli.test.ts#L100), [`git-cli.test.ts:112`](libs/shared/src/project/workspace/git-cli.test.ts#L112), [`git-cli.test.ts:130`](libs/shared/src/project/workspace/git-cli.test.ts#L130), [`workspace.test.ts:39`](libs/shared/src/project/workspace/workspace.test.ts#L39), [`workspace.test.ts:52`](libs/shared/src/project/workspace/workspace.test.ts#L52))
- FR-20.14: The `Repo` files port reads a file at a given ref (null when
  absent) and creates a branch committing a file via the API, repo bound.
  ([validated by `repo-files.test.ts:53`](libs/shared/src/project/repo/repo-files.test.ts#L53), [`repo-files.test.ts:59`](libs/shared/src/project/repo/repo-files.test.ts#L59), [`repo-files.test.ts:65`](libs/shared/src/project/repo/repo-files.test.ts#L65))
- FR-20.15: The `PullRequests` port lists only the repo's PRs, merges by
  number with the requested method, and exposes PR reads bound to the
  repo and number. ([validated by `pull-requests.test.ts:70`](libs/shared/src/project/pulls/pull-requests.test.ts#L70), [`pull-requests.test.ts:106`](libs/shared/src/project/pulls/pull-requests.test.ts#L106), [`pull-requests.test.ts:115`](libs/shared/src/project/pulls/pull-requests.test.ts#L115))
- FR-20.16: The `Issues` port returns the GitHubPort issues for the
  project's repo, creates an issue bound to the repo, and comments,
  closes, and labels by number bound to the repo. ([validated by `issues.test.ts:57`](libs/shared/src/project/issues/issues.test.ts#L57), [`issues.test.ts:101`](libs/shared/src/project/issues/issues.test.ts#L101), [`issues.test.ts:114`](libs/shared/src/project/issues/issues.test.ts#L114))
- FR-20.17: The `TestRunner` port lists tests in a trusted sandbox (no
  `LORE_DB_HOST`); its exec adapter lists the descriptors from the
  manifest `list` command, runs a single test aggregating the report, and
  runs `run` once per file (selector = file) fanning the result to each
  descriptor. ([validated by `test-suite.test.ts:43`](libs/shared/src/project/test-runner/test-suite.test.ts#L43), [`test-runner-exec.test.ts:42`](libs/shared/src/project/test-runner/test-runner-exec.test.ts#L42), [`test-runner-exec.test.ts:50`](libs/shared/src/project/test-runner/test-runner-exec.test.ts#L50), [`test-runner-exec.test.ts:64`](libs/shared/src/project/test-runner/test-runner-exec.test.ts#L64))
- FR-20.18: The accounting ports persist their own tables: `usage`
  inserts an `llm_calls` row (defaulting cost and null task) and returns
  today/total counts (missing rows default to zero); `cost` upserts
  `pipeline.anthropic_cost_daily` keyed on `(bucket_date, model)` —
  appending an unseen pair, replacing a same-key row, keeping separate
  rows per model; `job_runs` inserts a running row returning its id,
  marks it completed/failed with summary/error and log path (defaulting
  the path to null) and selects the most-recent `started_at` for a job
  (null when never run); `evals` inserts an `eval_runs` row and reads the
  latest and previous (offset 1) pass_rate per team for the regression
  check; and `baseline` inserts a JSON-serialized counter snapshot and
  reads windowed PR/median-time-to-merge counters from `pipeline.tasks`
  (defaulting an empty window to zero/null, excluding other repos and
  out-of-window rows). ([validated by `usage-pg.test.ts:22`](libs/shared/src/project/usage/usage-pg.test.ts#L22), [`usage-pg.test.ts:48`](libs/shared/src/project/usage/usage-pg.test.ts#L48), [`usage-pg.test.ts:75`](libs/shared/src/project/usage/usage-pg.test.ts#L75), [`usage-pg.test.ts:90`](libs/shared/src/project/usage/usage-pg.test.ts#L90), [`usage-pg.test.ts:105`](libs/shared/src/project/usage/usage-pg.test.ts#L105), [`usage-pg.test.ts:121`](libs/shared/src/project/usage/usage-pg.test.ts#L121), [`usage-pg.test.ts:134`](libs/shared/src/project/usage/usage-pg.test.ts#L134), [`usage-pg.test.ts:151`](libs/shared/src/project/usage/usage-pg.test.ts#L151), [`usage-pg.test.ts:169`](libs/shared/src/project/usage/usage-pg.test.ts#L169), [`cost.test.ts:36`](libs/shared/src/project/cost/cost.test.ts#L36), [`cost.test.ts:60`](libs/shared/src/project/cost/cost.test.ts#L60), [`cost.test.ts:68`](libs/shared/src/project/cost/cost.test.ts#L68), [`cost.test.ts:80`](libs/shared/src/project/cost/cost.test.ts#L80), [`job-runs.test.ts:23`](libs/shared/src/project/job-runs/job-runs.test.ts#L23), [`job-runs.test.ts:36`](libs/shared/src/project/job-runs/job-runs.test.ts#L36), [`job-runs.test.ts:54`](libs/shared/src/project/job-runs/job-runs.test.ts#L54), [`job-runs.test.ts:62`](libs/shared/src/project/job-runs/job-runs.test.ts#L62), [`job-runs.test.ts:72`](libs/shared/src/project/job-runs/job-runs.test.ts#L72), [`job-runs.test.ts:86`](libs/shared/src/project/job-runs/job-runs.test.ts#L86), [`job-runs.test.ts:94`](libs/shared/src/project/job-runs/job-runs.test.ts#L94), [`job-runs.test.ts:104`](libs/shared/src/project/job-runs/job-runs.test.ts#L104), [`job-runs.test.ts:118`](libs/shared/src/project/job-runs/job-runs.test.ts#L118), [`job-runs.test.ts:131`](libs/shared/src/project/job-runs/job-runs.test.ts#L131), [`job-runs.test.ts:172`](libs/shared/src/project/job-runs/job-runs.test.ts#L172), [`evals.test.ts:23`](libs/shared/src/project/evals/evals.test.ts#L23), [`evals.test.ts:38`](libs/shared/src/project/evals/evals.test.ts#L38), [`evals.test.ts:48`](libs/shared/src/project/evals/evals.test.ts#L48), [`evals.test.ts:59`](libs/shared/src/project/evals/evals.test.ts#L59), [`evals.test.ts:81`](libs/shared/src/project/evals/evals.test.ts#L81), [`evals.test.ts:102`](libs/shared/src/project/evals/evals.test.ts#L102), [`evals.test.ts:123`](libs/shared/src/project/evals/evals.test.ts#L123), [`baseline.test.ts:23`](libs/shared/src/project/baseline/baseline.test.ts#L23), [`baseline.test.ts:46`](libs/shared/src/project/baseline/baseline.test.ts#L46), [`baseline.test.ts:64`](libs/shared/src/project/baseline/baseline.test.ts#L64), [`baseline.test.ts:78`](libs/shared/src/project/baseline/baseline.test.ts#L78), [`baseline.test.ts:92`](libs/shared/src/project/baseline/baseline.test.ts#L92), [`baseline.test.ts:125`](libs/shared/src/project/baseline/baseline.test.ts#L125))
- FR-20.19: The `Archive` GCS port saves to `<bucket>/<key>`
  non-resumable with the given content type (passing `cacheControl`
  through as file metadata) and returns the object content as utf-8, null
  when the object is absent or the storage call throws. ([validated by `archive-gcs.test.ts:38`](libs/shared/src/project/archive/archive-gcs.test.ts#L38), [`archive-gcs.test.ts:55`](libs/shared/src/project/archive/archive-gcs.test.ts#L55), [`archive-gcs.test.ts:73`](libs/shared/src/project/archive/archive-gcs.test.ts#L73), [`archive-gcs.test.ts:83`](libs/shared/src/project/archive/archive-gcs.test.ts#L83), [`archive-gcs.test.ts:92`](libs/shared/src/project/archive/archive-gcs.test.ts#L92))
- FR-20.20: Chunk-schema resolution is single-sourced in the shared
  `chunk-schema` module: a candidate schema name is kept only when it is
  regex-safe and provisioned (an invalid, injection-shaped, or absent
  name falls back to `org_shared` without an existence check, and
  `org_shared` itself short-circuits); a repo resolves through
  `lore.repos.team` to its provisioned team schema, else `org_shared`
  (no team, or an unprovisioned team schema, both fall back); the
  resolution is memoized per pool so concurrent readers share one
  lookup, pools stay isolated, and a failed lookup is never cached; and
  the schema enumeration lists every provisioned `chunks` schema,
  dropping regex-unsafe names and always including `org_shared` exactly
  once. ([validated by `chunk-schema.test.ts:29`](libs/shared/src/project/chunks/chunk-schema.test.ts#L29), [`chunk-schema.test.ts:37`](libs/shared/src/project/chunks/chunk-schema.test.ts#L37), [`chunk-schema.test.ts:43`](libs/shared/src/project/chunks/chunk-schema.test.ts#L43), [`chunk-schema.test.ts:50`](libs/shared/src/project/chunks/chunk-schema.test.ts#L50), [`chunk-schema.test.ts:59`](libs/shared/src/project/chunks/chunk-schema.test.ts#L59), [`chunk-schema.test.ts:68`](libs/shared/src/project/chunks/chunk-schema.test.ts#L68), [`chunk-schema.test.ts:80`](libs/shared/src/project/chunks/chunk-schema.test.ts#L80), [`chunk-schema.test.ts:89`](libs/shared/src/project/chunks/chunk-schema.test.ts#L89), [`chunk-schema.test.ts:97`](libs/shared/src/project/chunks/chunk-schema.test.ts#L97), [`chunk-schema.test.ts:112`](libs/shared/src/project/chunks/chunk-schema.test.ts#L112), [`chunk-schema.test.ts:125`](libs/shared/src/project/chunks/chunk-schema.test.ts#L125), [`chunk-schema.test.ts:152`](libs/shared/src/project/chunks/chunk-schema.test.ts#L152), [`chunk-schema.test.ts:165`](libs/shared/src/project/chunks/chunk-schema.test.ts#L165))
- FR-20.21: Legacy chunk relocation is self-healing: the nightly reindex,
  before counting a team-resolved repo's chunks, MOVEs any rows the repo
  still holds in `org_shared.chunks` into its resolved schema — per-file
  dedupe keeps a file already fresh in the target and drops its stale
  org_shared duplicates, files absent from the target relocate wholesale
  preserving id, embedding, and `ingested_at`, rewriting `team`, stamping
  `metadata.migrated_from` ([validated by `chunks.test.ts:672`](libs/shared/src/project/chunks/chunks.test.ts#L672), [`chunks.test.ts:689`](libs/shared/src/project/chunks/chunks.test.ts#L689), [`chunks.test.ts:722`](libs/shared/src/project/chunks/chunks.test.ts#L722))
  - Provenance-less rows with a classifyFile content type are adopted via
    `ingested_by = 'reindex-job'`; other content types relocate unowned ([validated by `chunks.test.ts:672`](libs/shared/src/project/chunks/chunks.test.ts#L672), [`chunks.test.ts:712`](libs/shared/src/project/chunks/chunks.test.ts#L712))
  - The Pg adapter issues copy and delete as one statement (shared
    snapshot, insert before delete, repo and team as bind parameters),
    a clean repo is a zero no-op, and `org_shared` is rejected as a
    relocation target in every adapter — self-relocation would dedupe
    rows against themselves and delete them ([validated by `chunks.test.ts:735`](libs/shared/src/project/chunks/chunks.test.ts#L735), [`chunks.test.ts:746`](libs/shared/src/project/chunks/chunks.test.ts#L746), [`chunks.test.ts:758`](libs/shared/src/project/chunks/chunks.test.ts#L758))
  - The station HTTP adapter refuses relocation as Floor-only ([validated by `chunks-http.test.ts:94`](libs/shared/src/project/chunks/chunks-http.test.ts#L94))
  - The web-ui settings route emits one `internal.repo.team_changed` event
    only when a POST actually changes the team value (settings-only updates
    and same-value posts emit nothing; clearing a team normalizes empty
    string to null), and a failed event insert degrades to the nightly
    relocation instead of failing the settings write ([validated by `route.test.ts:39`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L39), [`route.test.ts:55`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L55), [`route.test.ts:63`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L63), [`route.test.ts:71`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L71), [`route.test.ts:79`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L79))
  - The Floor's `team_changed` handler re-reads the team from `lore.repos`
    rather than trusting the event payload, resolves it through the uncached
    single-sourced `chunkSchemaOrOrgShared` (never the per-repo memoized
    resolver, which would serve the pre-change schema for its TTL), no-ops
    when resolution falls back to `org_shared`, and lets a relocation error
    propagate so the event loop retries the idempotent move ([validated by `repo-team-changed.test.ts:47`](apps/floor/src/jobs/repo-team-changed.test.ts#L47), [`repo-team-changed.test.ts:66`](apps/floor/src/jobs/repo-team-changed.test.ts#L66), [`repo-team-changed.test.ts:81`](apps/floor/src/jobs/repo-team-changed.test.ts#L81), [`repo-team-changed.test.ts:89`](apps/floor/src/jobs/repo-team-changed.test.ts#L89), [`repo-team-changed.test.ts:102`](apps/floor/src/jobs/repo-team-changed.test.ts#L102))

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
- Web UI (`/onboard`, pipeline status, task logs, analytics, knowledge graph, gaps). ([validated by `GapsView.test.tsx:26`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L26), [`GraphView.test.tsx:35`](apps/web-ui/src/app/graph/GraphView.test.tsx#L35), [`AnalyticsView.test.tsx:116`](apps/web-ui/src/app/analytics/AnalyticsView.test.tsx#L116), [`TaskLogs.test.tsx:93`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L93), [`OnboardView.test.tsx:8`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L8))
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
