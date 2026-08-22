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

Lore is shared context infrastructure for Claude Code: one install command
gives every developer full organizational awareness — conventions, ADRs, team
patterns, PR history, and task state — served automatically from a central
context repository rather than loaded by hand each session.

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
> surface now lives in `specs/mcp-tools/`).

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

**New Developer (Day 1)**

A developer who has just joined Acme. They have no knowledge of org
conventions, team patterns, or architectural history. They need to
become productive without reading hundreds of pages of documentation.

**Active Developer (Daily Use)**

A developer who works in one or more product repos daily. They need
Claude Code to understand their team's conventions, the reasoning
behind past decisions, and their current task state — automatically.

**Tech Lead / Architect**

Reviews PRs, makes architectural decisions, and ensures consistency
across teams. They need the system to capture and distribute decisions
so they are not the bottleneck for "why did we do it this way?"
questions.

**Platform Engineer**

Maintains the Lore infrastructure itself. They need observability
into what context is being served, where gaps exist, and how the
system is performing.

## Background — Usage Scenarios

**Scenario 1 — First-Time Setup**

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

**Scenario 2 — Morning Orientation**

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

**Scenario 3 — Starting a New Feature**

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

**Scenario 4 — Opening a Pull Request**

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

**Scenario 5 — Context Quality Enforcement**

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

**Scenario 6 — Semantic Context Search (Phase 1)**

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

**Scenario 7 — Cluster Delegation (Phase 1)**

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
- Agent nodes also get a **live, scoped** Lore MCP for the run's duration:
  the seeded agent recipe carries a `resources.mcp_servers` entry
  (`name: lore`, `transport: http`, `headers_secret: lore-mcp-auth`) and drops
  `lore_create_pipeline_task`, so the pod can search memory/context and record
  targeted memory mid-task — not only start pre-hydrated. A shared `lore-mcp`
  gateway serves those tools over MCP-over-HTTP at a public `:443` host (the
  agent-pod NetworkPolicy allows only public `:443` egress). ([validated by `agent-catalog.test.ts:62`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L62), [`agent-catalog.test.ts:20`](apps/floor/src/jobs/agent/agent-catalog.test.ts#L20))
- The gateway reads each request body defensively: it JSON-parses the body
  (an empty body carries no payload), caps it at 1 MB (`413` over the cap) so an
  authenticated-but-rogue pod cannot exhaust gateway memory, and returns `400`
  for a malformed body rather than a `500`. ([validated by `http-transport.test.ts:10`](apps/mcp-server/src/server/http-transport.test.ts#L10), [`http-transport.test.ts:14`](apps/mcp-server/src/server/http-transport.test.ts#L14), [`http-transport.test.ts:18`](apps/mcp-server/src/server/http-transport.test.ts#L18), [`http-transport.test.ts:24`](apps/mcp-server/src/server/http-transport.test.ts#L24))
- When no gateway URL is configured (the default, and every cluster before the
  gateway is deployed), the seeded agent recipes omit the `mcp_servers` block
  entirely — no empty-`url` MCP entry lands in any recipe CRD. ([validated by `catalog-mcp-guard.test.ts:12`](apps/floor/src/jobs/agent/catalog-mcp-guard.test.ts#L12))
- The gateway also serves an **agent-skills registry** at `/skills` (unauthenticated —
  skills are org conventions, not secrets): `GET /skills/settings.json` returns the org
  session settings/hooks, and `GET /skills/<name>.tar.gz` streams a gzip tarball of the
  baked skill directory, rejecting an unsafe/traversing name with `404`. The
  ai-agent-subsystem init fetches these into a run's `$HOME/.claude` (recipe
  `resources.skills` + `skills_source`, ADR-030). ([validated by `skills-registry.test.ts:42`](apps/mcp-server/src/server/skills-registry.test.ts#L42), [`skills-registry.test.ts:50`](apps/mcp-server/src/server/skills-registry.test.ts#L50), [`skills-registry.test.ts:63`](apps/mcp-server/src/server/skills-registry.test.ts#L63), [`skills-registry.test.ts:74`](apps/mcp-server/src/server/skills-registry.test.ts#L74))
- Developer can check task status and retrieve results without
  leaving Claude Code.
- The pipeline task is visible in the shared task tracker — no
  duplicate work. ([validated by `AssemblyRunListView.test.tsx:14`](apps/web-ui/src/app/assembly-runs/AssemblyRunListView.test.tsx#L14))
- Watcher posts the PR link and any Slack notifications on completion.

**Scenario 8 — Automated Gap Detection (Phase 2)**

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

**Scenario 9 — Temporal Knowledge Graph Traversal (Phase 3)**

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

The system MUST provide a single-command install experience. ([validated by `install-contract.test.mjs:13`](scripts/install-contract.test.mjs#L13))

- FR-3.1: Install script clones the context repo, builds the MCP
  server, detects team, configures Claude Code settings, installs
  platform skills, and runs health checks. ([validated by `install-contract.test.mjs:13`](scripts/install-contract.test.mjs#L13), [`install-contract.test.mjs:52`](scripts/install-contract.test.mjs#L52), [`install-contract.test.mjs:65`](scripts/install-contract.test.mjs#L65), [`install-contract.test.mjs:78`](scripts/install-contract.test.mjs#L78), [`install-contract.test.mjs:91`](scripts/install-contract.test.mjs#L91), [`install-contract.test.mjs:99`](scripts/install-contract.test.mjs#L99), [`install-contract.test.mjs:143`](scripts/install-contract.test.mjs#L143))
- FR-3.2: Install script is idempotent — re-running always produces
  correct state. ([validated by `install-contract.test.mjs:117`](scripts/install-contract.test.mjs#L117), [`install-contract.test.mjs:130`](scripts/install-contract.test.mjs#L130), [`install-contract.test.mjs:156`](scripts/install-contract.test.mjs#L156))
- FR-3.3: Install script works without pre-cloning the repository. ([validated by `install-contract.test.mjs:26`](scripts/install-contract.test.mjs#L26), [`install-contract.test.mjs:39`](scripts/install-contract.test.mjs#L39))
- FR-3.4: Settings merge (via helper script) appends platform hooks
  without overwriting personal developer hooks. ([validated by `lore-merge-settings.test.mjs:25`](scripts/lore-merge-settings.test.mjs#L25), [`lore-merge-settings.test.mjs:41`](scripts/lore-merge-settings.test.mjs#L41))
- Decision: the `lore-doctor` health-check script tests all connections and
  prints clear pass/fail with fix instructions for each.

### FR-4: Task Tracking Integration

The system MUST provide agent-native task tracking via PostgreSQL
pipeline tasks and GitHub Issues. ([validated by `task-queue.test.ts:22`](libs/shared/src/project/tasks/task-queue.test.ts#L22))

- Decision: the generated `AGENTS.md` instructs Claude Code on task-tracking
  commands and proactive guidance behaviour.
- Decision: a SessionStart hook syncs task state automatically.
- Decision: a Stop (session-end) hook reminds about open claimed tasks.
- FR-4.4: `lore_sync_tasks` MCP tool converts tasks.md task output into
  pipeline tasks with dependency relationships parsed from
  `[DEPENDS ON: ...]` annotations. ([validated by `tasks.test.ts:60`](libs/shared/src/tasks.test.ts#L60))
- FR-4.5: Concurrent task claiming uses `SELECT ... FOR UPDATE SKIP
  LOCKED` — atomically prevents duplicate work without versioning
  overhead. A claim attempt on a taken task returns an immediate
  error; the developer or agent reads the ready list and picks
  another task. ([validated by `task-queue.test.ts:9`](libs/shared/src/project/tasks/task-queue.test.ts#L9))
- FR-4.6: Every pipeline task automatically creates a GitHub Issue
  on the target repo (labelled `lore-managed`). The issue receives
  status comments and is closed when the PR is created. ([validated by `issues.test.ts:102`](libs/shared/src/project/issues/issues.test.ts#L103), [`issues.test.ts:115`](libs/shared/src/project/issues/issues.test.ts#L116))
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
skills. ([validated by `planning-prompt.test.ts:21`](libs/shared/src/feature-planning/planning-prompt.test.ts#L52))

- FR-5.1: `/lore-feature` skill guides the full loop: constitution
  generation → specification → task breakdown → pipeline task wiring. ([validated by `planning-prompt.test.ts:143`](libs/shared/src/feature-planning/planning-prompt.test.ts#L168), [`planning-prompt.test.ts:21`](libs/shared/src/feature-planning/planning-prompt.test.ts#L52))
- FR-5.2: `/lore-pr` skill drafts PR descriptions from spec, task
  context, and changed files. ([validated by `pr-body.test.ts:5`](libs/shared/src/pr-body.test.ts#L5), [`pr-body.test.ts:11`](libs/shared/src/pr-body.test.ts#L11))
- Decision: constitution generation (the `lore-gen-constitution` glue script)
  calls `lore_assemble_context` to populate `.specify/constitution.md` with
  real ADRs and team conventions.
- FR-5.4: Claude Code does mechanical work; developer confirms only
  at decision points (constitution review, spec review, task
  breakdown review). ([validated by `planning-prompt.test.ts:59`](libs/shared/src/feature-planning/planning-prompt.test.ts#L90), [`planning-prompt.test.ts:71`](libs/shared/src/feature-planning/planning-prompt.test.ts#L102))

### FR-6: PR Quality Enforcement

The system MUST enforce PR description quality from day one. ([validated by `pr-section-check.test.ts:28`](libs/shared/src/pr-section-check.test.ts#L28), [`pr-section-check.test.ts:32`](libs/shared/src/pr-section-check.test.ts#L32))

- FR-6.1: PR template with required sections: Why, What Changed,
  Alternatives Considered, ADRs & Architecture, and Testing. ([validated by `pr-template.test.ts:11`](libs/shared/src/pr-template.test.ts#L11), [`pr-template.test.ts:15`](libs/shared/src/pr-template.test.ts#L15), [`pr-template.test.ts:19`](libs/shared/src/pr-template.test.ts#L19), [`pr-template.test.ts:23`](libs/shared/src/pr-template.test.ts#L23), [`pr-template.test.ts:27`](libs/shared/src/pr-template.test.ts#L27), [`pr-template.test.ts:31`](libs/shared/src/pr-template.test.ts#L31))
- FR-6.2: CI check fails PRs with an empty Why or Alternatives Considered
  section. ([validated by `pr-section-check.test.ts:36`](libs/shared/src/pr-section-check.test.ts#L36), [`pr-section-check.test.ts:46`](libs/shared/src/pr-section-check.test.ts#L46), [`pr-section-check.test.ts:57`](libs/shared/src/pr-section-check.test.ts#L57), [`pr-section-check.test.ts:69`](libs/shared/src/pr-section-check.test.ts#L69), [`pr-section-check.test.ts:80`](libs/shared/src/pr-section-check.test.ts#L80), [`pr-section-check.test.ts:94`](libs/shared/src/pr-section-check.test.ts#L94), [`pr-section-check.test.ts:103`](libs/shared/src/pr-section-check.test.ts#L103), [`pr-section-check.test.ts:109`](libs/shared/src/pr-section-check.test.ts#L109), [`pr-section-check.test.ts:113`](libs/shared/src/pr-section-check.test.ts#L113))
- Decision: PR-quality enforcement starts in warning-only mode; the platform
  team flips it to hard-fail via a configuration flag in the CI workflow —
  there is no automatic date-based cutoff.

### FR-7: Ingestion Pipeline (Phase 1)

The system MUST ingest content from multiple sources into the vector
store via the Lore Agent service. ([validated by `content-classify.test.ts:5`](libs/shared/src/content-classify.test.ts#L5))

- FR-7.1: Fast path: on-push to main triggers incremental ingestion
  via pipeline task. ([validated by `ingest-workflow.test.ts:11`](libs/shared/src/ingest-workflow.test.ts#L11), [`ci-ingest.test.ts:28`](apps/floor/src/delivery/http/routes/ci-ingest.test.ts#L28))
- FR-7.2: Full path: nightly job triggers complete re-index via
  pipeline task. ([validated by `reindex-backfill.test.ts:24`](apps/floor/src/jobs/context-jobs/reindex/reindex-backfill.test.ts#L24), [`reindex-seed.test.ts:5`](apps/floor/src/jobs/context-jobs/reindex/reindex-seed.test.ts#L5))
- FR-7.3: Content types: code (AST-split), pull requests (diff +
  description + comments), ADRs, docs (section-chunked), specs,
  runbooks. ([validated by `chunker.test.ts:6`](libs/shared/src/chunker.test.ts#L6), [`chunker.test.ts:172`](libs/shared/src/chunker.test.ts#L172), [`content-classify.test.ts:11`](libs/shared/src/content-classify.test.ts#L11))
- FR-7.4: Secret and credential redaction runs at ingest time via
  `redactSecrets()`; matched secrets are stripped before content is
  embedded and made searchable. ([validated by `redact.test.ts:5`](libs/shared/src/redact.test.ts#L5), [`redact.test.ts:30`](libs/shared/src/redact.test.ts#L30))
- FR-7.5: Beyond chunking and embedding, the Lore Agent drafts missing
  content and opens PRs (the gap-detection drafting path, FR-10). ([validated by `gap-detect.test.ts:123`](libs/shared/src/detect/gap-detect.test.ts#L123))
- FR-7.6: Nightly re-index MUST hard-delete chunks whose source
  file, PR, or ADR no longer exists or has been superseded. No
  stale content is retained. ([validated by `verify.test.ts:69`](apps/floor/src/jobs/context-jobs/reindex/verify.test.ts#L69), [`chunks.test.ts:394`](libs/shared/src/project/chunks/chunks.test.ts#L394))

### FR-8: Observability (Phase 1)

The system MUST provide observability into context retrieval quality. ([validated by `otel.test.ts:6`](libs/server-core/src/platform/otel.test.ts#L6), [`usage-tools.test.ts:51`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L51))

- Decision: all MCP retrieval calls are traced via OpenTelemetry spans
  exported to Cloud Monitoring (SDK-level instrumentation).
- FR-8.2: Low-confidence retrievals (score < threshold) tagged as
  gap candidates via OTEL span attributes and Cloud Monitoring
  custom metrics. ([validated by `otel.test.ts:6`](libs/server-core/src/platform/otel.test.ts#L6), [`otel.test.ts:10`](libs/server-core/src/platform/otel.test.ts#L10), [`otel.test.ts:14`](libs/server-core/src/platform/otel.test.ts#L14))
- See ADR-010 for the autoresearch loop: the low-confidence gap signal
  (Langfuse trace queries → candidate generation → PromptFoo eval → PR)
  drives automated context improvement.
- FR-8.4: `lore_my_usage` tool exposes per-developer token consumption
  (today / 7-day / 30-day) without leaving Claude Code. ([validated by `usage-tools.test.ts:51`](apps/mcp-server/src/mcp/tools/usage-tools.test.ts#L51), [`usage-pg.test.ts:105`](libs/shared/src/project/usage/usage-pg.test.ts#L145))

### FR-9: Context Evaluation (Phase 1)

The system MUST validate context quality via CI.

- FR-9.1: PromptFoo eval suite with 5-10 test cases per team
  (stored in `evals/`).
- FR-9.2: Teams own their eval cases.
- FR-9.3: Pass threshold: 85% required to merge.
- FR-9.4: Evals triggered on changes to ADRs, team CLAUDE.md files,
  root CLAUDE.md, and spec files.

### FR-10: Gap Detection (Phase 2)

The system MUST automatically identify and address knowledge gaps. ([validated by `gap-detect.test.ts:105`](libs/shared/src/detect/gap-detect.test.ts#L105))

- See ADR-010: a weekly job analyzes low-confidence retrievals from the
  previous week (the autoresearch gap loop).
- Decision: candidate gaps are clustered by embedding similarity.
- FR-10.3: For a repo missing a documentation kind (CLAUDE.md, ADRs, or
  specs), the `gap-detect` job drafts the missing content as a `gap-fill`
  task. ([validated by `gap-detect.test.ts:123`](libs/shared/src/detect/gap-detect.test.ts#L123))
- Decision: the agent opens PRs to the context repo with the drafted content,
  assigned to the relevant team.
- Decision: human review is required before any auto-drafted content is merged.
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
live knowledge graph. ([validated by `graph.test.ts:49`](libs/server-core/src/features/memory/graph.test.ts#L49))

- FR-11.1: Knowledge graph stored in `memory.entities` and
  `memory.edges` tables in PostgreSQL. Updated incrementally on
  every `lore_write_episode` call via the Lore Agent fact extractor. ([validated by `graph.test.ts:137`](libs/server-core/src/features/memory/graph.test.ts#L137))
- FR-11.2: Entity types: Service, Team, Function, PR, ADR, Spec,
  Concept, Runbook. Typed relationships: OWNS, CALLS, IMPLEMENTS,
  SUPERSEDES, REFERENCES, AUTHORED_BY, DEFINES. ([validated by `graph.test.ts:49`](libs/server-core/src/features/memory/graph.test.ts#L49), [`graph.test.ts:117`](libs/server-core/src/features/memory/graph.test.ts#L117))
- FR-11.3: `lore_query_graph(query)` MCP tool traverses the live graph
  for multi-hop relationship results. ([validated by `memory-tools.test.ts:48`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L48))
- FR-11.4: Facts carry temporal validity (`valid_from`/`valid_to`),
  confidence tiers (`verified` / `observed` / `inferred` / `stale`),
  and retrieval metadata (`retrieval_count`, `last_retrieved_at`,
  `half_life_days`). ([validated by `facts.test.ts:105`](libs/server-core/src/features/memory/facts.test.ts#L105), [`memory-ranking.test.ts:162`](libs/shared/src/memory-ranking.test.ts#L162))
- FR-11.5: Contradiction detection: when a new fact has cosine
  similarity ≥ 0.92 to an existing one, the old fact is invalidated
  and a conflict record written to `memory.fact_conflicts`. Context
  assembly prefixes `[CONFLICT]` on facts with recent (7-day)
  conflicts. ([validated by `facts.test.ts:105`](libs/server-core/src/features/memory/facts.test.ts#L105), [`facts.test.ts:138`](libs/server-core/src/features/memory/facts.test.ts#L138))

### FR-12: Intelligent Memory Lifecycle (Phase 1)

The system MUST manage agent memory automatically without agent
cooperation. ([validated by `session-tracker.test.ts:193`](libs/server-core/src/platform/session-tracker.test.ts#L193))

- FR-12.1: MCP server tracks all tool calls in a 500-entry ring
  buffer (`session-tracker.ts`). On exit, dumps to
  `~/.lore/last-session.json`. Stop hook POSTs to
  `/api/session-summary` for automatic episode + fact extraction. ([validated by `session-tracker.test.ts:193`](libs/server-core/src/platform/session-tracker.test.ts#L193), [`session-tracker.test.ts:73`](libs/server-core/src/platform/session-tracker.test.ts#L73))
- FR-12.2: Daily job at 5 AM scores memories 0-10 using half-life
  decay (`strength = 0.5^(age / half_life_days)`). Evicts
  lowest-scoring memories when agent exceeds 500 entries. Cleans
  invalidated facts older than 30 days beyond the 2000 cap. ([validated by `memory-ranking.test.ts:143`](libs/shared/src/memory-ranking.test.ts#L143))
- FR-12.3: Daily job at 5:30 AM groups recent facts (7-day lookback)
  by repo and calls Haiku to extract 1-3 higher-level patterns per
  repo. Stored as `consolidated/{repo}/{timestamp}` memories.
  Minimum 5 facts required to trigger consolidation. ([validated by `memory-lifecycle.test.ts:103`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L103), [`memory-lifecycle.test.ts:202`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L202))
- FR-12.4: Every `lore_search_memory` call asynchronously increments
  `retrieval_count`, updates `last_retrieved_at`, and extends
  `half_life_days` (+2, cap 365) on returned facts. Stale facts
  revive to `observed` on retrieval. Fire-and-forget — adds zero
  latency to search. ([validated by `memory-lifecycle.test.ts:218`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L218), [`memory-lifecycle.test.ts:192`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L192))
- FR-12.5: After every pipeline task completion (PR, no-changes,
  failure), an episode is automatically written. For high-signal
  events (PRs, failures), Haiku extracts a lesson and stores it
  as `auto-curation/{ref}` memory. ([validated by `episode-writer.test.ts:78`](apps/floor/src/jobs/lib/episode-writer.test.ts#L78))

### FR-13: Autonomous Review Loop (Phase 1, opt-in)

The system MUST support an opt-in, webhook-driven autonomous review loop per
repo with a safety-net cron (ADR-015; the review agent runs on the
ai-agent-subsystem per ADR-031). ([validated by `code-review.test.ts:91`](apps/floor/src/jobs/review/code-review.test.ts#L91))

- FR-13.1: After an implementation PR is created, an auto-review is started on
  the ai-agent-subsystem when `auto_review` is enabled on the repo (ADR-031
  retired the loretask-watcher). ([validated by `should-auto-review.test.ts:5`](apps/floor/src/jobs/review/should-auto-review.test.ts#L5), [`code-review.test.ts:91`](apps/floor/src/jobs/review/code-review.test.ts#L91))
- FR-13.2: The review agent reads spec + conventions and posts ONE formal PR
  review — inline comments per finding plus a summary, carrying the verdict as its
  GitHub review event (`APPROVE` / `REQUEST_CHANGES`, always on, no longer a neutral comment). ([validated by `post-review.test.ts:78`](apps/floor/src/jobs/review/post-review.test.ts#L78), [`post-review.test.ts:178`](apps/floor/src/jobs/review/post-review.test.ts#L178))
- FR-13.3: On a formal `APPROVE` the PR becomes eligible for (auto-)merge once the
  remaining gates pass; auto-merge reads the bot's latest review, so a later push's re-check verdict supersedes the earlier one. ([validated by `post-review.test.ts:178`](apps/floor/src/jobs/review/post-review.test.ts#L178), [`auto-merge.test.ts:32`](apps/floor/src/jobs/merge/auto-merge.test.ts#L32))
- FR-13.4: When changes are requested, a follow-up round is started on the same
  branch carrying the feedback (the code-review-reply path). ([validated by `code-review.test.ts:113`](apps/floor/src/jobs/review/code-review.test.ts#L113))
- FR-13.5: After further iterations the loop escalates to human review via a
  `needs-human-help` Issue, with no further autonomous iterations. ([validated by `escalation.test.ts:87`](apps/floor/src/jobs/platform/escalation.test.ts#L87), [`escalation.test.ts:162`](apps/floor/src/jobs/platform/escalation.test.ts#L162))
- FR-13.6: The primary trigger is GitHub webhooks (ADR-015): the Floor webhook
  ingress maps qualifying `pull_request`, `pull_request_review`, and PR
  `issue_comment` events to the code-review choreography, which starts or
  replies on a code-review assembly line; bot-authored events are skipped as a
  loop guard. ([validated by `code-review.test.ts:91`](apps/floor/src/jobs/review/code-review.test.ts#L91), [`code-review.test.ts:242`](apps/floor/src/jobs/review/code-review.test.ts#L242))
- FR-13.7: **Safety-net cron** fires at `7 7-17 * * 1-5` (UTC,
  Mon-Fri) to catch dropped webhook deliveries. Cron-triggered runs
  are gated by `isBusinessHours()` (default: Europe/Berlin, 09:00-18:00
  Mon-Fri via `LORE_BUSINESS_HOURS_{TZ,START,END,DAYS}` env vars).
  Webhook-triggered runs are never gated by business hours. ([validated by `business-hours.test.ts:38`](libs/shared/src/business-hours.test.ts#L38))
- Decision: the webhook trigger degrades gracefully when its ingress env is
  absent — a warning is logged and the safety-net cron (FR-13.7) covers the gap.

### FR-14: Spec Drift Detection (Phase 2)

The system MUST detect when specifications diverge from implementation. ([validated by `chunks.test.ts:190`](libs/shared/src/project/chunks/chunks.test.ts#L190), [`chunks.test.ts:212`](libs/shared/src/project/chunks/chunks.test.ts#L212))

- FR-14.1: Weekly job reads spec assertions and checks against
  current code via AST analysis. ([validated by `fan-out.test.ts:41`](apps/floor/src/jobs/detect/fan-out.test.ts#L42))
- Decision: divergence above 20% of a spec's assertions triggers a `gap-fill`
  pipeline task for the owning team.
- FR-14.3: Test files and generated files are excluded. ([validated by `chunks.test.ts:887`](libs/shared/src/project/chunks/chunks.test.ts#L887), [`chunks.test.ts:920`](libs/shared/src/project/chunks/chunks.test.ts#L920))
- FR-14.4: Spec-drift reads a repo's spec chunks and code symbols from
  the repo's resolved schema (team schema when provisioned, `org_shared`
  otherwise) — the same schema the reindex job wrote them to. The
  `codeSymbols` read excludes `symbol_type = 'call'` chunks, so a test
  file's `describe` title can never satisfy the drift heuristic's
  known-symbol check for a deleted declaration.
  ([validated by `chunks.test.ts:153`](libs/shared/src/project/chunks/chunks.test.ts#L153), [`chunks.test.ts:171`](libs/shared/src/project/chunks/chunks.test.ts#L171), [`chunks.test.ts:190`](libs/shared/src/project/chunks/chunks.test.ts#L190), [`chunks.test.ts:212`](libs/shared/src/project/chunks/chunks.test.ts#L212), [`chunks.test.ts:887`](libs/shared/src/project/chunks/chunks.test.ts#L887), [`chunks.test.ts:920`](libs/shared/src/project/chunks/chunks.test.ts#L920))

### FR-15: Progressive Trust (Phase 1)

The system MUST gate task types per-repo based on demonstrated
reliability. ([validated by `pipeline-tasks.trust.test.ts:37`](libs/shared/src/pipeline-tasks.trust.test.ts#L37))

- FR-15.1: `settings.trust.level` controls which task types are
  allowed: `docs` (gap-fill/runbook/onboard + feature-planning/
  feature-finalize per ADR-027), `tests` (+review),
  `implementation` (+implementation/feature-request/general),
  `full` (all). `onboard` is allowed at every tier — it produces a
  docs-only scaffolding PR and duplicate protection lives in its own
  route's guard, not the trust ladder. ([validated by `allows an onboard task at trust level %s`](libs/shared/src/pipeline-tasks.trust.test.ts#L37), [`still refuses an implementation task at trust level docs`](libs/shared/src/pipeline-tasks.trust.test.ts#L52))
- FR-15.2: Trust auto-promotes after 3 successful merges at the current level
  (overridable per repo via `auto_promote_threshold`), climbing
  `docs → tests → implementation → full` and resetting the merge counter on
  each promotion. A repo already at `full`, or carrying no level at all, is
  left untouched rather than banking a counter with nothing to spend it on.
  The default level is `implementation` for backward compatibility. ([validated by `trust-ladder.test.ts:5`](apps/floor/src/jobs/merge/trust-ladder.test.ts#L5), [`trust-ladder.test.ts:14`](apps/floor/src/jobs/merge/trust-ladder.test.ts#L14), [`trust-ladder.test.ts:23`](apps/floor/src/jobs/merge/trust-ladder.test.ts#L23), [`trust-ladder.test.ts:38`](apps/floor/src/jobs/merge/trust-ladder.test.ts#L38), [`trust-ladder.test.ts:47`](apps/floor/src/jobs/merge/trust-ladder.test.ts#L47), [`trust-ladder.test.ts:56`](apps/floor/src/jobs/merge/trust-ladder.test.ts#L56))

### FR-16: Prompt Caching on Agent LLM Calls (Phase 1)

The system MUST cache repeated LLM prefixes on all agent-side Anthropic
API calls to reduce token cost (ADR-015, added 2026-04-17). ([validated by `prompt-cache.test.ts:93`](libs/shared/src/llm/prompt-cache.test.ts#L93))

- FR-16.1: `libs/shared/src/llm/anthropic-provider.ts` places two cache
  breakpoints per request — one on the system prompt block
  (`buildCacheableSystem`), one on the tool schema block
  (`buildCacheableTools`) — so a tool-schema edit cannot bust the system
  cache and vice versa. ([validated by `anthropic-provider.test.ts:13`](libs/shared/src/llm/anthropic-provider.test.ts#L13), [`anthropic-provider.test.ts:39`](libs/shared/src/llm/anthropic-provider.test.ts#L39), [`anthropic-provider.test.ts:55`](libs/shared/src/llm/anthropic-provider.test.ts#L55))
- FR-16.2: `getCacheControl(jobName)` from `agent/src/lib/prompt-cache.ts`
  returns `{type: "ephemeral", ttl: "1h"}` for jobs in the
  `LORE_CACHE_1H_JOBS` allowlist and `{type: "ephemeral"}` (5-min)
  otherwise. Default allowlist: `auto-curation`, `review_reactor`,
  `fact-extraction`, `graph-extraction`. Special values: `none`
  disables 1h everywhere; `*` enables it for every job. ([validated by `prompt-cache.test.ts:93`](libs/shared/src/llm/prompt-cache.test.ts#L93), [`anthropic-provider.test.ts:25`](libs/shared/src/llm/anthropic-provider.test.ts#L25))
- Decision: cache eligibility is latched at module load to prevent
  mid-process toggles from busting the server-side cache.
- FR-16.4: Each call computes a djb2 hash of the system + tools prefix
  and compares to the last call for the same `jobName`. Log line
  emits: `cache hit | first-call | break:system | break:tools |
  break:ttl(Nm)`. ([validated by `prompt-cache.test.ts:123`](libs/shared/src/llm/prompt-cache.test.ts#L123), [`prompt-cache.test.ts:129`](libs/shared/src/llm/prompt-cache.test.ts#L129))
- FR-16.5: `response.usage.cache_creation_input_tokens` and
  `cache_read_input_tokens` feed cost accounting (1.25× writes,
  0.1× reads). ([validated by `anthropic-provider.test.ts:79`](libs/shared/src/llm/anthropic-provider.test.ts#L79), [`anthropic-provider.test.ts:87`](libs/shared/src/llm/anthropic-provider.test.ts#L87), [`anthropic-provider.test.ts:95`](libs/shared/src/llm/anthropic-provider.test.ts#L95))
- Decision: MCP-server raw fetch call sites (fact extraction, graph
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
non-terminal states and resolve them without manual intervention. ([validated by `task-queue.test.ts:348`](libs/shared/src/project/tasks/task-queue.test.ts#L348))

- FR-18.1: A `stale_task_check` job runs hourly at `:17` and flags
  tasks in `running` or `pending` state for longer than their
  configured timeout plus a grace period. ([validated by `task-queue.test.ts:348`](libs/shared/src/project/tasks/task-queue.test.ts#L348))
- FR-18.2: Stuck tasks are transitioned to a terminal state
  (`failed` with reason `timeout_exceeded`) so the pipeline does not
  stall waiting for a pod that has already exited. ([validated by `task-queue.test.ts:348`](libs/shared/src/project/tasks/task-queue.test.ts#L348))
- FR-18.3: The transition is idempotent — if a task completes between
  detection and the state write, the write is a no-op. ([validated by `task-store-pg.test.ts:74`](libs/shared/src/project/tasks/task-store-pg.test.ts#L74))
- FR-18.4: A failure episode is written for each stuck task so the
  auto-curation pipeline can surface patterns (e.g. a task type that
  consistently times out). ([validated by `episode-writer.test.ts:78`](apps/floor/src/jobs/lib/episode-writer.test.ts#L78), [`episode-writer.test.ts:12`](apps/floor/src/jobs/lib/episode-writer.test.ts#L12))

### FR-19: Task Detail UI (Phase 1)

The web UI MUST present a per-task detail view at `/tasks/[id]` that
surfaces the task's metadata, run attempts, stage timeline, PR status,
event history, and LLM-call ledger. ([validated by `TaskDetailView.test.tsx:96`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L96))

Live sections follow a data-down/actions-up split: pure `*View`
presentational components are fed by IO `*Panel` containers that own
fetching and polling. ([validated by `TimelinePanel.test.tsx:82`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L82))

- FR-19.1: The detail heading reads `Task: <description>` with the
  description truncated to 80 characters, and the view shows the task
  type, target repo, creator, and a sentence-cased status badge.
  Priority renders as a red badge when `immediate` and falls back to a
  plain `normal` meta label when empty. ([validated by `TaskDetailView.test.tsx:96`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L96), [`TaskDetailView.test.tsx:115`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L115), [`TaskDetailView.test.tsx:123`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L123), [`TaskDetailView.test.tsx:135`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L135), [`TaskDetailView.test.tsx:142`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L142))
- FR-19.2: The agent row, failure row, and review-iterations row each
  render only when their value is present (agent assigned, failure
  reason set, review iteration greater than zero) and are omitted
  otherwise. ([validated by `TaskDetailView.test.tsx:196`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L196), [`TaskDetailView.test.tsx:202`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L202), [`TaskDetailView.test.tsx:224`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L224), [`TaskDetailView.test.tsx:230`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L230), [`TaskDetailView.test.tsx:236`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L236))
- FR-19.3: The view lists the task's run attempts under a "Runs"
  heading, each linking to its run detail at `/assembly-runs/<run-id>`,
  and omits the section entirely when the task has no runs. ([validated by `TaskDetailView.test.tsx:67`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L67), [`TaskDetailView.test.tsx:88`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L88))
- FR-19.4: In-flight controls follow actions-up: a "Run Now" form
  posting to `/api/tasks/<id>/run-now` appears only for pending
  normal-priority tasks; a "Cancel Task" control appears for
  non-terminal tasks and is hidden once merged or completed; the
  confirm-gated `CancelTaskButton` shows only its trigger until clicked,
  then reveals a form posting to `/api/tasks/<id>/cancel` that "Keep
  task" backs out of; and a "Give Feedback" form wired to the injected
  server action (with a hidden `task_id`) shows only for a task that has
  a PR and is not cancelled. ([validated by `TaskDetailView.test.tsx:149`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L149), [`TaskDetailView.test.tsx:160`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L160), [`TaskDetailView.test.tsx:167`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L167), [`TaskDetailView.test.tsx:176`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L176), [`TaskDetailView.test.tsx:189`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L189), [`TaskDetailView.test.tsx:265`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L265), [`TaskDetailView.test.tsx:286`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L286), [`TaskDetailView.test.tsx:293`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L293), [`CancelTaskButton.test.tsx:7`](apps/web-ui/src/app/tasks/[id]/CancelTaskButton.test.tsx#L7), [`CancelTaskButton.test.tsx:17`](apps/web-ui/src/app/tasks/[id]/CancelTaskButton.test.tsx#L17), [`CancelTaskButton.test.tsx:30`](apps/web-ui/src/app/tasks/[id]/CancelTaskButton.test.tsx#L30))
- FR-19.5: When a failed task carries a failed-event with metadata, the
  view renders a "Failure" panel surfacing the error; absent that
  metadata no panel is shown. ([validated by `TaskDetailView.test.tsx:241`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L241), [`TaskDetailView.test.tsx:258`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L258))
- FR-19.6: The event timeline renders one badge per status transition
  (sentence-cased to-status with a from-status arrow), pretty-prints
  event metadata as JSON, and shows an empty-state note when there are
  no events. ([validated by `TaskDetailView.test.tsx:306`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L306), [`EventTimeline.test.tsx:18`](apps/web-ui/src/app/tasks/[id]/EventTimeline.test.tsx#L18), [`EventTimeline.test.tsx:32`](apps/web-ui/src/app/tasks/[id]/EventTimeline.test.tsx#L32), [`EventTimeline.test.tsx:40`](apps/web-ui/src/app/tasks/[id]/EventTimeline.test.tsx#L40))
- FR-19.7: The LLM-calls table renders one row per call with the model,
  `input / output` token counts, duration, and a status badge (red with
  the error text on failure), and shows an empty-state note in place of
  the table when there are none. ([validated by `TaskDetailView.test.tsx:336`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L336), [`TaskDetailView.test.tsx:354`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L354), [`TaskDetailView.test.tsx:368`](apps/web-ui/src/app/tasks/[id]/TaskDetailView.test.tsx#L368), [`LlmCallsTable.test.tsx:19`](apps/web-ui/src/app/tasks/[id]/LlmCallsTable.test.tsx#L19), [`LlmCallsTable.test.tsx:27`](apps/web-ui/src/app/tasks/[id]/LlmCallsTable.test.tsx#L27), [`LlmCallsTable.test.tsx:35`](apps/web-ui/src/app/tasks/[id]/LlmCallsTable.test.tsx#L35))
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
  refreshes on the page coordinator's ticks while the task is active
  (driven by `initialStatus` or a still-active `current_stage`), reports
  inactive for a terminal status whose stage is `retrospective` so no
  ticks reach it, and stops fetching after unmount. ([validated by `TimelinePanel.test.tsx:82`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L82), [`TimelinePanel.test.tsx:103`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L103), [`TimelinePanel.test.tsx:113`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L116), [`TimelinePanel.test.tsx:123`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L126), [`TimelinePanel.test.tsx:136`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L139), [`TimelinePanel.test.tsx:148`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L151), [`TimelinePanel.test.tsx:168`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L171), [`TimelinePanel.test.tsx:193`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L196), [`TimelinePanel.test.tsx:211`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L214), [`TimelinePanel.test.tsx:234`](apps/web-ui/src/app/tasks/[id]/TimelinePanel.test.tsx#L237))
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
  not fetch after unmount, keeps the loaded details when a later
  refresh fails, and reports inactive after a failed refresh so the
  coordinator stops re-fetching it. ([validated by `PRStatusPanel.test.tsx:84`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L84), [`PRStatusPanel.test.tsx:94`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L97), [`PRStatusPanel.test.tsx:107`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L110), [`PRStatusPanel.test.tsx:123`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L126), [`PRStatusPanel.test.tsx:139`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L142), [`PRStatusPanel.test.tsx:157`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L168), [`PRStatusPanel.test.tsx:185`](apps/web-ui/src/app/tasks/[id]/PRStatusPanel.test.tsx#L196))

- FR-19.12: The task-refresh presenter makes every scheduling decision
  as pure functions: the live run is the newest non-terminal
  `pipeline.assembly_lines` attempt (empty, all-terminal, and unsorted
  inputs handled; `queued` counts as live; `created_at` sorts correctly
  whether it arrives as a string or a Date); the refresh driver is
  `idle` with no active panel, `poll` without a live run, without
  EventSource, or after the stream gives up, and `stream` otherwise;
  the interval is null when idle, a 30-second heartbeat on a live
  stream, and the 10-second coordinated cadence otherwise (including
  while the stream is still connecting or reconnecting);
  event-triggered refreshes wait out the remainder of the 3-second
  window (zero delay at or past the boundary); the stream cursor folds
  numerically (ids past MAX_SAFE_INTEGER compare correctly, non-numeric
  candidates keep the cursor); and the runs check stays active while a
  run is attached (so its terminality is re-read, task status
  regardless) or, unattached, while the task status can still mint a
  run — never with no active panel. ([validated by `task-refresh-presenter.test.ts:25`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L25), [`task-refresh-presenter.test.ts:29`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L29), [`task-refresh-presenter.test.ts:38`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L38), [`task-refresh-presenter.test.ts:47`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L47), [`task-refresh-presenter.test.ts:69`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L69), [`task-refresh-presenter.test.ts:73`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L73), [`task-refresh-presenter.test.ts:92`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L92), [`task-refresh-presenter.test.ts:103`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L103), [`task-refresh-presenter.test.ts:114`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L114), [`task-refresh-presenter.test.ts:125`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L125), [`task-refresh-presenter.test.ts:136`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L136), [`task-refresh-presenter.test.ts:149`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L149), [`task-refresh-presenter.test.ts:153`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L153), [`task-refresh-presenter.test.ts:157`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L157), [`task-refresh-presenter.test.ts:161`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L161), [`task-refresh-presenter.test.ts:167`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L167), [`task-refresh-presenter.test.ts:173`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L173), [`task-refresh-presenter.test.ts:179`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L179), [`task-refresh-presenter.test.ts:185`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L185), [`task-refresh-presenter.test.ts:191`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L191), [`task-refresh-presenter.test.ts:195`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L195), [`task-refresh-presenter.test.ts:199`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L199), [`task-refresh-presenter.test.ts:203`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L203), [`task-refresh-presenter.test.ts:211`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L211), [`task-refresh-presenter.test.ts:221`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L221), [`task-refresh-presenter.test.ts:231`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L231), [`task-refresh-presenter.test.ts:241`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L241), [`task-refresh-presenter.test.ts:251`](apps/web-ui/src/app/tasks/[id]/task-refresh-presenter.test.ts#L251))
- FR-19.13: The task-refresh provider is the page's single scheduler:
  it never ticks with no active panel, stops when the last panel goes
  inactive or on unmount, and a panel without a provider ancestor never
  auto-refreshes; a tick refreshes active panels and skips inactive
  ones; a running run at mount opens exactly one EventSource on the
  run's stream proxy — none when every run is terminal or no panel is
  active, and the socket closes when the page goes idle;
  catchup-complete flips the `live` flag panels render from; the
  catch-up replay burst triggers no immediate refresh wave, an event
  past the window refreshes at once, and a burst inside it coalesces
  into one trailing refresh at the window boundary; the interval slows
  to the heartbeat while the stream is live and returns to coordinated
  polling after the stream's bounded give-up; a run minted after mount
  is discovered via `/api/tasks/<id>/runs` on poll ticks and attaches
  the stream — never for a terminal task status with nothing attached,
  and a discovery response with no live run keeps polling; and the
  attached run's recorded status is re-checked on ticks, detaching a
  finished run back to coordinated polling and attaching a retry's
  fresh run in its place. ([validated by `TaskRefreshProvider.test.tsx:147`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L147), [`TaskRefreshProvider.test.tsx:157`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L157), [`TaskRefreshProvider.test.tsx:177`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L177), [`TaskRefreshProvider.test.tsx:193`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L193), [`TaskRefreshProvider.test.tsx:206`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L206), [`TaskRefreshProvider.test.tsx:218`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L218), [`TaskRefreshProvider.test.tsx:232`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L232), [`TaskRefreshProvider.test.tsx:243`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L243), [`TaskRefreshProvider.test.tsx:254`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L254), [`TaskRefreshProvider.test.tsx:269`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L269), [`TaskRefreshProvider.test.tsx:288`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L288), [`TaskRefreshProvider.test.tsx:309`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L309), [`TaskRefreshProvider.test.tsx:336`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L336), [`TaskRefreshProvider.test.tsx:357`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L357), [`TaskRefreshProvider.test.tsx:388`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L388), [`TaskRefreshProvider.test.tsx:414`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L417), [`TaskRefreshProvider.test.tsx:440`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L443), [`TaskRefreshProvider.test.tsx:470`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L473), [`TaskRefreshProvider.test.tsx:489`](apps/web-ui/src/app/tasks/[id]/TaskRefreshProvider.test.tsx#L492))
- FR-19.14: `GET /api/tasks/[id]/runs` serves the task's per-attempt
  run rows newest first, behind the timeline route's auth ladder (401
  without a session, 404 for an unknown task, 403 without repo access),
  returning an empty list on pre-0025 databases, exporting
  `force-dynamic`, and mapping a thrown lookup to a 500. The rows come
  from lore-api's `GET /api/tasks/{id}/runs`, not from
  `pipeline.assembly_lines` directly: the repo this route authorizes
  against and the runs it returns must be read through one source, or
  the two can disagree about which task they describe. ([validated by `route.test.ts:34`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L34), [`route.test.ts:39`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L39), [`route.test.ts:48`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L48), [`route.test.ts:61`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L61), [`route.test.ts:77`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L77), [`route.test.ts:102`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L102), [`route.test.ts:110`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L110), [`route.test.ts:118`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L118), [`route.test.ts:127`](apps/web-ui/src/app/api/tasks/[id]/runs/route.test.ts#L127))

- FR-19.15: lore-api serves those rows at `GET /api/tasks/{id}/runs`,
  under the `read` scope: 503 without a pool, 404 for a task that does
  not exist, the run rows newest first, and an empty list — not a 500 —
  when the database predates migration 0025 and has no
  `pipeline.assembly_lines` table. The 404 comes before the run query
  deliberately: an unknown id and a task with no runs both answered
  `{runs: []}` before, which reads as "nothing started yet" for a task
  that never existed. ([validated by `task-runs.test.ts:30`](apps/lore-api/src/api/routes/tasks/task-runs.test.ts#L30), [`task-runs.test.ts:36`](apps/lore-api/src/api/routes/tasks/task-runs.test.ts#L36), [`task-runs.test.ts:46`](apps/lore-api/src/api/routes/tasks/task-runs.test.ts#L46), [`task-runs.test.ts:72`](apps/lore-api/src/api/routes/tasks/task-runs.test.ts#L72))
- FR-19.16: The two task transitions the UI offers are shared seams in
  `libs/shared`, not route-local SQL. `escalateTask` (run-now) refuses an
  unknown id and anything past `pending`, sets `priority = 'immediate'`,
  and records the transition carrying the priority it replaced.
  `cancelTask` treats `completed`, `merged`, `failed` and `cancelled` as
  terminal — `completed` was missing, so the web UI's own guard refused
  a click the API accepted. ([validated by `sets priority immediate on a pending task`](libs/shared/src/pipeline-tasks.escalate.test.ts#L28), [`pipeline-tasks.escalate.test.ts:42`](libs/shared/src/pipeline-tasks.escalate.test.ts#L42), [`pipeline-tasks.escalate.test.ts:59`](libs/shared/src/pipeline-tasks.escalate.test.ts#L59), [`pipeline-tasks.escalate.test.ts:67`](libs/shared/src/pipeline-tasks.escalate.test.ts#L67), [`pipeline-tasks.escalate.test.ts:80`](libs/shared/src/pipeline-tasks.escalate.test.ts#L80), [`pipeline-tasks.escalate.test.ts:91`](libs/shared/src/pipeline-tasks.escalate.test.ts#L91))

- FR-19.17: lore-api serves one `lore.repos` row at
  `GET /api/repos/{owner}/{repo}` under the `read` scope, reading it
  through the Project facade for the repo in the path, 404 for a repo
  with no row and 500 for a failed lookup. It returns the record WHOLE
  rather than a per-caller projection: nine web-ui call sites across
  five files each selected a different column subset of this row, and
  projecting per caller would move that duplication into the API
  instead of removing it. ([validated by `repo-record.test.ts:69`](apps/lore-api/src/api/routes/repos/repo-record.test.ts#L69), [`repo-record.test.ts:78`](apps/lore-api/src/api/routes/repos/repo-record.test.ts#L78), [`repo-record.test.ts:86`](apps/lore-api/src/api/routes/repos/repo-record.test.ts#L86), [`repo-record.test.ts:95`](apps/lore-api/src/api/routes/repos/repo-record.test.ts#L95))
- FR-19.18: `SettingsPort.record(repo)` is that read — the whole row or
  null — implemented by the Pg adapter against `lore.repos` and by the
  in-memory double over its seeded rows, so a caller that needs more
  than `rawSettings` or `team` has one place to get it. ([validated by returns the seeded row as the camelCase model](libs/shared/src/project/settings/settings-record.test.ts#L55), [`settings-record.test.ts:66`](libs/shared/src/project/settings/settings-record.test.ts#L66), [`settings-record.test.ts:74`](libs/shared/src/project/settings/settings-record.test.ts#L74), [`settings-record.test.ts:92`](libs/shared/src/project/settings/settings-record.test.ts#L92), [`settings-record.test.ts:104`](libs/shared/src/project/settings/settings-record.test.ts#L104))

- FR-19.19: lore-api serves the run views' four reads under the `read`
  scope — `GET /api/assembly-lines` (filterable by status, repo, or a
  `task_id` that answers the newest attempt first, default limit 50),
  `GET /api/assembly-lines/{id}`, `.../nodes` in visit order, and
  `.../token-usage`, which sums the four usage scalars across the run's
  turns SQL-side. The SQL moved verbatim from web-ui, LATERAL cost
  fallback included: a run whose `llm_calls` predate per-line
  attribution still costs what its task cost. Every read degrades to
  empty — a 404 for the by-id one — rather than 500 on a database
  predating the tables, because a run view is additive and a page must
  not go down over an unmigrated cluster. Token usage reads
  `pipeline.agent_run_turns`, not `llm_calls`: the cost table is
  authoritative but a row lands only when a run ENDS, which is the
  moment the card showing the number disappears. ([validated by `assembly-lines.test.ts:102`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L102), [`assembly-lines.test.ts:106`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L106), [`assembly-lines.test.ts:122`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L122), [`assembly-lines.test.ts:169`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L169), [`assembly-lines.test.ts:185`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L185), [`assembly-lines.test.ts:202`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L202), [`assembly-lines.test.ts:383`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L383), [`assembly-lines.test.ts:396`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L396), [`assembly-lines.test.ts:404`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L404), [`assembly-lines.test.ts:416`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L416), [`assembly-lines.test.ts:464`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L464), [`assembly-lines.test.ts:476`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L476), [`assembly-lines.test.ts:496`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L496), [`assembly-lines.test.ts:506`](apps/lore-api/src/api/routes/assembly-lines/assembly-lines.test.ts#L506))

- FR-19.20: lore-api serves the activity reads the audit, gaps, events,
  job-run and repo-overview views need, all under the `read` scope:
  `GET /api/memory-audit` (agent / operation filters plus a
  `zero_results` lens for the gap view, answering a page AND the unpaged
  total the pager needs), `GET /api/events` (repo-scoped, newest first,
  repo required), `GET /api/job-runs/{id}`, and
  `GET /api/repos/{owner}/{repo}/activity-counts` (7-day tasks,
  auto-merges and escalations). A count the database cannot answer is
  NULL, never zero: an unmigrated cluster must not render as "nothing
  happened", and no dashboard figure may take its page down. ([validated by `activity.test.ts:31`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L31), [`activity.test.ts:35`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L35), [`activity.test.ts:49`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L49), [`activity.test.ts:60`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L60), [`activity.test.ts:70`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L70), [`activity.test.ts:83`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L83), [`activity.test.ts:94`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L94), [`activity.test.ts:98`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L98), [`activity.test.ts:112`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L112), [`activity.test.ts:125`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L125), [`activity.test.ts:135`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L135), [`activity.test.ts:148`](apps/lore-api/src/api/routes/analytics/activity.test.ts#L148))

- FR-19.21: lore-api serves the memory browse reads under the `read`
  scope — `GET /api/graph-browse` (counts, type breakdown, entity list,
  and the selected entity's edges), `GET /api/pools` and
  `GET /api/pools/{name}`, `GET /api/episodes`, `GET /api/memories`
  and `GET /api/memory-search`. Shaped per SCREEN, not per table: the
  graph explorer renders four reads at once, and four endpoints would
  cost four round trips for a page that is the only caller of each.
  Edges are read ONLY when an entity is selected — the explorer's most
  expensive query must not run on every page view — and invalidated ones
  stay hidden unless asked for. `/api/memories` returns each memory with
  its version history and facts, skipping the fact read for a memory
  whose `has_facts` says it has none; the page it replaced fanned out up
  to 201 round trips for one screen. `/api/memory-search` is LEXICAL
  (ts_rank over raw text), the search page's question — the embedding
  search remains `POST /api/memory`. ([validated by `memory-browse.test.ts:31`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L31), [`memory-browse.test.ts:35`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L35), [`memory-browse.test.ts:51`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L51), [`memory-browse.test.ts:64`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L64), [`memory-browse.test.ts:78`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L78), [`memory-browse.test.ts:91`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L91), [`memory-browse.test.ts:106`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L106), [`memory-browse.test.ts:117`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L117), [`memory-browse.test.ts:130`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L130), [`memory-browse.test.ts:140`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L140), [`memory-browse.test.ts:153`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L153), [`memory-browse.test.ts:164`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L164), [`memory-browse.test.ts:179`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L179), [`memory-browse.test.ts:189`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L189), [`memory-browse.test.ts:218`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L218), [`memory-browse.test.ts:195`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L195), [`memory-browse.test.ts:230`](apps/lore-api/src/api/routes/memory/memory-browse.test.ts#L230))

- FR-19.22: lore-api serves the task-shaped dashboard reads under the
  `read` scope — `GET /api/repo-tasks` (a repo's most recent, empty on a
  database with no `pipeline.tasks`), `GET /api/task-stats` (org totals),
  `GET /api/agent-activity` (per-agent task counts and spend, org-wide or
  repo-scoped), `GET /api/tasks/{id}/runtime` (its transitions and LLM
  calls) and `GET /api/audit-log` (a repo's entries, filtered to the
  decision types the caller renders). Agent activity FULL OUTER JOINs the
  task agents with the memory agents: an agent that only ever wrote
  memories — a developer's local MCP — appears in no task row, and
  dropping it would hide exactly the agents a human recognises. The
  aggregates stay SQL-side because the alternative is shipping the whole
  pipeline history to Node for one dashboard row per agent. ([validated by [`task-views.test.ts:31`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L31), [`task-views.test.ts:37`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L37), [`task-views.test.ts:48`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L48), [`task-views.test.ts:52`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L52), [`task-views.test.ts:66`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L66), [`task-views.test.ts:79`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L79), [`task-views.test.ts:90`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L90), [`task-views.test.ts:102`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L102), [`task-views.test.ts:117`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L117), [`task-views.test.ts:135`](apps/lore-api/src/api/routes/tasks/task-views.test.ts#L135))

- FR-19.23: lore-api serves the two spend/analytics screens whole —
  `GET /api/spend` (ten month-to-date aggregates) and
  `GET /api/analytics-overview` (six reads). Spend draws on BOTH cost
  sources deliberately: `pipeline.anthropic_cost_daily` is Anthropic's
  authoritative billed figure, but its buckets close at UTC midnight and
  the in-progress day is never emitted, so the billed total ends at the
  last SYNCED day — yesterday when the daily sync is current, earlier
  when it ran late or failed — and `pipeline.llm_calls` — token-exact
  against the hourly report, available with no admin key — is what brings
  it current for every day after `MAX(bucket_date)`, however many that
  is. Assuming that gap was always exactly one day is what let whole
  days of spend fall into neither figure. The
  billed reads degrade to empty on a cluster without the table, and
  availability is decided by the `as_of` STAMP rather than a row count:
  only the stamp separates "synced, nothing owed" from "never synced",
  and the view hides the section for the second instead of showing a
  confident zero. ([validated by [`spend.test.ts:33`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L33), [`spend.test.ts:37`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L37), [`spend.test.ts:49`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L49), [`spend.test.ts:79`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L79), [`spend.test.ts:83`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L83), [`spend.test.ts:108`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L108), [`spend.test.ts:132`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L132), [`spend.test.ts:193`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L193), [`spend.test.ts:209`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L209), [`spend.test.ts:222`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L222), [`spend.test.ts:145`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L145))

- FR-19.24: `reviseTask` is the human feedback loop as ONE seam: it
  queues a follow-up task on the parent's branch and PR at immediate
  priority (a person is waiting), records the request on the parent
  naming the revision it spawned, and parks the parent at
  `revision-requested`. A feature-request revises as a feature-request
  and everything else as an implementation. It refuses an unknown id and
  refuses blank feedback rather than queueing an empty revision. The web
  UI reaches it through `POST /api/task` with `action: "revise"`; the
  three writes were previously three separate statements in a server
  action, where a dropped event left a parent pointing at a revision the
  timeline could not explain. ([validated by [`pipeline-tasks.escalate.test.ts:132`](libs/shared/src/pipeline-tasks.escalate.test.ts#L132), [`pipeline-tasks.escalate.test.ts:141`](libs/shared/src/pipeline-tasks.escalate.test.ts#L141), [`pipeline-tasks.escalate.test.ts:161`](libs/shared/src/pipeline-tasks.escalate.test.ts#L161), [`pipeline-tasks.escalate.test.ts:176`](libs/shared/src/pipeline-tasks.escalate.test.ts#L176), [`pipeline-tasks.escalate.test.ts:188`](libs/shared/src/pipeline-tasks.escalate.test.ts#L188), [`pipeline-tasks.escalate.test.ts:208`](libs/shared/src/pipeline-tasks.escalate.test.ts#L208), [`pipeline-tasks.escalate.test.ts:220`](libs/shared/src/pipeline-tasks.escalate.test.ts#L220), [`pipeline-tasks.escalate.test.ts:228`](libs/shared/src/pipeline-tasks.escalate.test.ts#L228))

- FR-19.25: lore-api serves the org-wide `lore.settings` under the
  `admin` scope — `GET /api/settings` (the entries plus the repo count
  the settings page shows) and `PUT /api/settings`, whose writable keys
  are an ALLOWLIST: that table holds the ingest token and the approval
  config, so a route upserting any key a caller named would let one
  invent settings the platform then reads. A blank value leaves the
  stored one alone rather than erasing it, because the form posts every
  field and an untouched secret arrives empty.
  `GET /api/repos/{owner}/{repo}/sessions` answers how many
  developers have run a local session against a repo. ([validated by [`org-settings.test.ts:44`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L44), [`org-settings.test.ts:50`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L50), [`org-settings.test.ts:67`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L67), [`org-settings.test.ts:83`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts:97`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L85), [`org-settings.test.ts:107`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L107), [`org-settings.test.ts:118`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L109), [`org-settings.test.ts:69`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L69), [`org-settings.test.ts:85`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L85), [`org-settings.test.ts:99`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L99), [`org-settings.test.ts:109`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L109), [`org-settings.test.ts:120`](apps/lore-api/src/api/routes/repos/org-settings.test.ts#L120), [`repos.test.ts:110`](apps/web-ui/src/lib/api/repos.test.ts#L110), [`repos.test.ts:120`](apps/web-ui/src/lib/api/repos.test.ts#L120))

- FR-19.26: lore-api serves the context browser's chunk reads —
  `GET /api/chunks` (ranked, org-wide or repo-scoped, one row past the
  page size so a caller detects a further page without a COUNT),
  `GET /api/chunk-types`, `GET /api/chunks/by-path`, and
  `GET /api/repos/{owner}/{repo}/chunk-summary`. Chunks live in per-team
  schemas plus `org_shared`, so a global read is a UNION ALL across every
  PROVISIONED schema: the catalog is the source of truth, not
  `lore.repos.team`, which is free text and can name a schema nobody ever
  created — unioning that would fail every chunk read, and dropping a real
  one would silently show a page missing another team's chunks. The chip
  set is deliberately unfiltered by the active type so a chip never
  disappears the moment it is selected. Moving this read, and the union
  builder with it, is what let web-ui stop holding a Postgres pool at all.
  ([validated by [`chunks-browse.test.ts:62`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L62), [`chunks-browse.test.ts:66`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L66), [`chunks-browse.test.ts:83`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L83), [`chunks-browse.test.ts:97`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L97), [`chunks-browse.test.ts:110`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L110), [`chunks-browse.test.ts:124`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L124), [`chunks-browse.test.ts:138`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L138), [`chunks-browse.test.ts:162`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L162), [`chunks-browse.test.ts:190`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L190), [`chunks-browse.test.ts:212`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L212), [`chunks-browse.test.ts:242`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L242), [`chunks-browse.test.ts:243`](apps/lore-api/src/api/routes/context/chunks-browse.test.ts#L243))

- FR-19.27: Anthropic's Admin API reports usage and cost and exposes NO
  credit balance, so what is LEFT cannot be fetched and is instead
  accumulated in `pipeline.credit_ledger` — an append-only record of money
  added, written through `POST /api/spend/credits` under the `write` scope
  and read back on `GET /api/spend` as a `budget` block. The ledger is
  append-only rather than a single mutable balance row: a wrong entry is
  compensated with a negative `correction`, never updated, so every write
  is one atomic INSERT and two people recording a top-up at the same moment
  cannot lose each other's entry. `remaining` is the recorded total minus
  spend since the EARLIEST entry, and that window is deliberately not
  month-to-date like every other figure on the screen — a balance added in
  June is still money in August, and clipping it to the current month would
  silently forgive every dollar spent before the 1st. Spend within the
  window is the same two sources the rest of the page reports side by side,
  meeting exactly at `billed_through`: billed covers up to and including
  it, Lore-computed starts strictly after, because an off-by-one there
  either double-counts a day or drops one and both yield a plausible
  balance that is wrong. An empty ledger and a missing table both yield a
  NULL budget rather than a zero one, on the same reasoning that makes
  `org_available` a stamp rather than a row count — nobody having recorded
  the balance is a different fact from the balance being nothing.
  ([`credit-ledger.test.ts:51`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L51), [`credit-ledger.test.ts:63`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L63), [`credit-ledger.test.ts:67`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L67), [`credit-ledger.test.ts:74`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L74), [`credit-ledger.test.ts:91`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L91), [`credit-ledger.test.ts:146`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L146), [`credit-ledger.test.ts:163`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L163), [`credit-ledger.test.ts:169`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L169), [`credit-ledger.test.ts:175`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L175), [`credit-ledger.test.ts:181`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L181), [`spend.test.ts:254`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L254), [`spend.test.ts:264`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L264), [`spend.test.ts:279`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L279), [`spend.test.ts:300`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L300), [`spend.test.ts:318`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L318), [`spend.test.ts:343`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L343), [`credit-ledger.test.ts:181`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L181), [`credit-ledger.test.ts:211`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L211), [`credit-ledger.test.ts:110`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L110), [`credit-ledger.test.ts:134`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L134), [`credit-ledger.test.ts:140`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L140), [`credit-ledger.test.ts:191`](apps/lore-api/src/api/routes/analytics/credit-ledger.test.ts#L191), [`spend.test.ts:366`](apps/lore-api/src/api/routes/analytics/spend.test.ts#L366))

- FR-19.28: `/spend` renders the remaining balance ABOVE the
  month-to-date figures, because "how much is left" is the question the
  screen is opened for and every figure below it is context for that one.
  A null budget renders an em dash and a prompt to record the balance, never
  a confident `$0.00` — the one placeholder on a page that otherwise degrades
  to nothing, and it is unfillable by design since no data source publishes a
  credit balance. A negative remaining is shown as a negative number in the
  danger colour rather than clamped at zero, because an overrun is the state
  most worth seeing. Alongside it the view projects an average daily burn
  since the anchor and how many days the balance covers at that rate,
  declining to project at all when the projection would be a guess dressed
  as a number — an anchor in the future, or no spend yet to average — and
  rounding day differences rather than flooring them, since a
  daylight-saving boundary makes a calendar day 23 or 25 hours long and
  flooring that loses a day from the divisor; a single remaining day reads
  "about a day left" rather than "about 1 days left", which is the line
  someone reads on the day it matters most. Recording a top-up is a
  server action that revalidates `/spend` on success, rejecting a blank or
  non-numeric amount before the request is made — `Number("")` is 0, not
  NaN, so a blank field would otherwise post a zero entry. The form carries a
  legend stating what each field does to the arithmetic, because two of the
  rules are counter-intuitive enough to have been got wrong during this
  feature’s own review: a blank date anchors to the start of today rather
  than to now — the label says so instead of saying "defaults to today",
  which reads either way — and a top-up recorded days late still yields the
  right figure, since only the opening entry moves the counting window.
  ([`SpendView.test.tsx:342`](apps/web-ui/src/app/spend/SpendView.test.tsx#L342), [`SpendView.test.tsx:357`](apps/web-ui/src/app/spend/SpendView.test.tsx#L357), [`SpendView.test.tsx:367`](apps/web-ui/src/app/spend/SpendView.test.tsx#L367), [`SpendView.test.tsx:379`](apps/web-ui/src/app/spend/SpendView.test.tsx#L379), [`SpendView.test.tsx:402`](apps/web-ui/src/app/spend/SpendView.test.tsx#L402), [`SpendView.test.tsx:411`](apps/web-ui/src/app/spend/SpendView.test.tsx#L411), [`SpendView.test.tsx:417`](apps/web-ui/src/app/spend/SpendView.test.tsx#L417), [`SpendView.test.tsx:425`](apps/web-ui/src/app/spend/SpendView.test.tsx#L425), [`SpendView.test.tsx:429`](apps/web-ui/src/app/spend/SpendView.test.tsx#L429), [`actions.test.ts:33`](apps/web-ui/src/app/spend/actions.test.ts#L33), [`actions.test.ts:46`](apps/web-ui/src/app/spend/actions.test.ts#L46), [`actions.test.ts:60`](apps/web-ui/src/app/spend/actions.test.ts#L60), [`actions.test.ts:74`](apps/web-ui/src/app/spend/actions.test.ts#L74), [`actions.test.ts:85`](apps/web-ui/src/app/spend/actions.test.ts#L85), [`actions.test.ts:94`](apps/web-ui/src/app/spend/actions.test.ts#L94), [`actions.test.ts:101`](apps/web-ui/src/app/spend/actions.test.ts#L101), [`actions.test.ts:108`](apps/web-ui/src/app/spend/actions.test.ts#L108), [`actions.test.ts:124`](apps/web-ui/src/app/spend/actions.test.ts#L124), [`actions.test.ts:136`](apps/web-ui/src/app/spend/actions.test.ts#L136), [`SpendView.test.tsx:442`](apps/web-ui/src/app/spend/SpendView.test.tsx#L442), [`SpendView.test.tsx:454`](apps/web-ui/src/app/spend/SpendView.test.tsx#L454), [`SpendView.test.tsx:473`](apps/web-ui/src/app/spend/SpendView.test.tsx#L473), [`SpendView.test.tsx:488`](apps/web-ui/src/app/spend/SpendView.test.tsx#L503), [`SpendView.test.tsx:498`](apps/web-ui/src/app/spend/SpendView.test.tsx#L513), [`SpendView.test.tsx:513`](apps/web-ui/src/app/spend/SpendView.test.tsx#L528), [`SpendView.test.tsx:524`](apps/web-ui/src/app/spend/SpendView.test.tsx#L539), [`SpendView.test.tsx:532`](apps/web-ui/src/app/spend/SpendView.test.tsx#L547), [`SpendView.test.tsx:544`](apps/web-ui/src/app/spend/SpendView.test.tsx#L559), [`SpendView.test.tsx:556`](apps/web-ui/src/app/spend/SpendView.test.tsx#L571), [`SpendView.test.tsx:568`](apps/web-ui/src/app/spend/SpendView.test.tsx#L583), [`SpendView.test.tsx:578`](apps/web-ui/src/app/spend/SpendView.test.tsx#L593))

### FR-20: Project Facade Ports (Phase 1)

The `Project` facade (ADR-024) exposes every data capability — tasks,
events, chunks, features, agents, workspace, PRs, issues, cost/usage
accounting — through repo-bound ports with a Postgres/GCS/HTTP adapter
and an in-memory double per port, so Floor, mcp-server, and lore-api
share one persistence surface instead of inline SQL. ([validated by `task-queue.test.ts:22`](libs/shared/src/project/tasks/task-queue.test.ts#L22))

- FR-20.1: The `TaskQueue` port drives org-wide claim/sweep: it claims
  one runnable pending task (immediate-first, past the minute interval,
  without the dead `running-local` predicate) or null, CAS-updates a
  still-pending row to a claimer (default or caller-supplied) and returns
  false when already claimed, stays org-wide with no params but scopes to
  a repo when given, flips a running task to completed (reporting
  same-spec dependents it unblocks, false for unknown/non-running), and
  exposes `awaitingApproval`, `distinctTargetRepos`, `prInfo`, and
  `findRecoverable`. ([validated by `task-queue.test.ts:22`](libs/shared/src/project/tasks/task-queue.test.ts#L22), [`task-queue.test.ts:29`](libs/shared/src/project/tasks/task-queue.test.ts#L29), [`task-queue.test.ts:37`](libs/shared/src/project/tasks/task-queue.test.ts#L37), [`task-queue.test.ts:51`](libs/shared/src/project/tasks/task-queue.test.ts#L51), [`task-queue.test.ts:60`](libs/shared/src/project/tasks/task-queue.test.ts#L60), [`task-queue.test.ts:69`](libs/shared/src/project/tasks/task-queue.test.ts#L69), [`task-queue.test.ts:77`](libs/shared/src/project/tasks/task-queue.test.ts#L77), [`task-queue.test.ts:85`](libs/shared/src/project/tasks/task-queue.test.ts#L85), [`task-queue.test.ts:95`](libs/shared/src/project/tasks/task-queue.test.ts#L95), [`task-queue.test.ts:104`](libs/shared/src/project/tasks/task-queue.test.ts#L104), [`task-queue.test.ts:115`](libs/shared/src/project/tasks/task-queue.test.ts#L115), [`task-queue.test.ts:129`](libs/shared/src/project/tasks/task-queue.test.ts#L129), [`task-queue.test.ts:182`](libs/shared/src/project/tasks/task-queue.test.ts#L182), [`task-queue.test.ts:193`](libs/shared/src/project/tasks/task-queue.test.ts#L193), [`task-queue.test.ts:206`](libs/shared/src/project/tasks/task-queue.test.ts#L206), [`task-queue.test.ts:220`](libs/shared/src/project/tasks/task-queue.test.ts#L220), [`task-queue.test.ts:278`](libs/shared/src/project/tasks/task-queue.test.ts#L278), [`task-queue.test.ts:288`](libs/shared/src/project/tasks/task-queue.test.ts#L288), [`task-queue.test.ts:317`](libs/shared/src/project/tasks/task-queue.test.ts#L317))
- FR-20.1b: `setColumns` writes only the given allow-listed task columns
  WITHOUT touching status or updated_at, issues no SQL for an empty column
  set, and throws on any key outside `SETTABLE_TASK_COLUMNS` — identically
  in the Pg adapter and the in-memory double, so a typo'd column fails
  loudly in tests instead of silently no-oping in production; the double
  additionally assigns the columns onto the seeded row and stays a no-op
  for an unknown task id. ([validated by `task-queue.test.ts:614`](libs/shared/src/project/tasks/task-queue.test.ts#L614), [`task-queue.test.ts:633`](libs/shared/src/project/tasks/task-queue.test.ts#L633), [`task-queue.test.ts:646`](libs/shared/src/project/tasks/task-queue.test.ts#L646), [`task-queue.test.ts:653`](libs/shared/src/project/tasks/task-queue.test.ts#L653), [`task-queue.test.ts:665`](libs/shared/src/project/tasks/task-queue.test.ts#L665), [`task-queue.test.ts:677`](libs/shared/src/project/tasks/task-queue.test.ts#L677))
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
  ([validated by `task-queue.test.ts:372`](libs/shared/src/project/tasks/task-queue.test.ts#L372), [`task-queue.test.ts:381`](libs/shared/src/project/tasks/task-queue.test.ts#L381), [`task-queue.test.ts:396`](libs/shared/src/project/tasks/task-queue.test.ts#L396), [`task-queue.test.ts:411`](libs/shared/src/project/tasks/task-queue.test.ts#L411), [`task-queue.test.ts:453`](libs/shared/src/project/tasks/task-queue.test.ts#L453), [`task-queue.test.ts:475`](libs/shared/src/project/tasks/task-queue.test.ts#L475), [`task-queue.test.ts:485`](libs/shared/src/project/tasks/task-queue.test.ts#L485), [`task-queue.test.ts:500`](libs/shared/src/project/tasks/task-queue.test.ts#L500), [`task-queue.test.ts:536`](libs/shared/src/project/tasks/task-queue.test.ts#L536))
- FR-20.3: The repo-scoped `TaskStore` port queries pending statuses,
  transitions a cancel to `cancelled`, writes `setStatus` (status +
  updated_at + only allowlisted extra columns), reads-old-then-writes-new
  status recording the transition event on `updateStatus`, and filters
  `findOpenLike` by repo, type, description prefix, and given statuses —
  each bound to the facade's repo. ([validated by `task-store-pg.test.ts:29`](libs/shared/src/project/tasks/task-store-pg.test.ts#L29), [`task-store-pg.test.ts:44`](libs/shared/src/project/tasks/task-store-pg.test.ts#L44), [`task-store-pg.test.ts:57`](libs/shared/src/project/tasks/task-store-pg.test.ts#L57), [`task-store-pg.test.ts:74`](libs/shared/src/project/tasks/task-store-pg.test.ts#L74), [`task-store-pg.test.ts:88`](libs/shared/src/project/tasks/task-store-pg.test.ts#L88))
- FR-20.3b: The in-memory `TaskStore` double is the behavioral spec of the
  Pg adapter across the whole port surface: the pending/running/executed
  views group the shared status unions newest-first per repo; `create`
  inserts a `pending` task with resolved priority, records the creation
  event, applies the trust gate only for a seeded repo, and rejects
  over-long descriptions; `retry` copies a failed task with a `retry_of`
  bundle marking the old one `retried` and refuses non-retryable states;
  `setStatus` writes only allowlisted extras (silently skipping unknown
  keys, matching `setTaskStatus`), `setStatusIf` is a CAS, `updateStatus`
  records the old-to-new event, and `cancel`/`markMerged` enforce the
  state guards; `transition` keeps `claimed_by` via COALESCE; and the
  dedup reads (`findOpenLike` with LIKE-wildcard semantics,
  `driftTasksForSpec` keyed on the bundle's spec_path), `list` paging, and
  `getWithEvents` mirror the SQL. ([validated by `task-store-memory.test.ts:38`](libs/shared/src/project/tasks/task-store-memory.test.ts#L38), [`task-store-memory.test.ts:48`](libs/shared/src/project/tasks/task-store-memory.test.ts#L48), [`task-store-memory.test.ts:69`](libs/shared/src/project/tasks/task-store-memory.test.ts#L69), [`task-store-memory.test.ts:90`](libs/shared/src/project/tasks/task-store-memory.test.ts#L90), [`task-store-memory.test.ts:100`](libs/shared/src/project/tasks/task-store-memory.test.ts#L100), [`task-store-memory.test.ts:125`](libs/shared/src/project/tasks/task-store-memory.test.ts#L125), [`task-store-memory.test.ts:137`](libs/shared/src/project/tasks/task-store-memory.test.ts#L137), [`task-store-memory.test.ts:149`](libs/shared/src/project/tasks/task-store-memory.test.ts#L149), [`task-store-memory.test.ts:157`](libs/shared/src/project/tasks/task-store-memory.test.ts#L157), [`task-store-memory.test.ts:171`](libs/shared/src/project/tasks/task-store-memory.test.ts#L171), [`task-store-memory.test.ts:194`](libs/shared/src/project/tasks/task-store-memory.test.ts#L194), [`task-store-memory.test.ts:227`](libs/shared/src/project/tasks/task-store-memory.test.ts#L227), [`task-store-memory.test.ts:275`](libs/shared/src/project/tasks/task-store-memory.test.ts#L275), [`task-store-memory.test.ts:365`](libs/shared/src/project/tasks/task-store-memory.test.ts#L365), [`task-store-memory.test.ts:379`](libs/shared/src/project/tasks/task-store-memory.test.ts#L379), [`task-store-memory.test.ts:395`](libs/shared/src/project/tasks/task-store-memory.test.ts#L395))
- FR-20.4: The task-list surface returns the repo's pending tasks as
  typed `Task` wrappers and reflects the new status after `cancel()`.
  ([validated by `task-list.test.ts:114`](libs/shared/src/project/tasks/task-list.test.ts#L114), [`task-list.test.ts:131`](libs/shared/src/project/tasks/task-list.test.ts#L131))
- FR-20.5: The `EventQueue` port claims runnable rows with `FOR UPDATE
  SKIP LOCKED` incrementing attempts (oldest-first, flipping to
  processing), collapses a redelivery sharing a dedupe key, truncates the
  error and applies the backoff on `markFailed` (a failed row becomes
  claimable only after the backoff elapses), resets timed-out processing
  rows to failed on `reapStuck`, and prunes handled/terminal rows past
  the window — returning affected-row counts. ([validated by `event-queue.test.ts:10`](libs/shared/src/project/events/event-queue.test.ts#L10), [`event-queue.test.ts:35`](libs/shared/src/project/events/event-queue.test.ts#L35), [`event-queue.test.ts:44`](libs/shared/src/project/events/event-queue.test.ts#L44), [`event-queue.test.ts:51`](libs/shared/src/project/events/event-queue.test.ts#L51), [`event-queue.test.ts:65`](libs/shared/src/project/events/event-queue.test.ts#L65), [`event-queue.test.ts:84`](libs/shared/src/project/events/event-queue.test.ts#L84), [`event-queue.test.ts:124`](libs/shared/src/project/events/event-queue.test.ts#L124), [`event-queue.test.ts:139`](libs/shared/src/project/events/event-queue.test.ts#L139), [`event-queue.test.ts:161`](libs/shared/src/project/events/event-queue.test.ts#L161))
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
  of the highest-numbered ready iteration (null when none). ([validated by `features-pg.test.ts:48`](libs/shared/src/project/features/features-pg.test.ts#L48), [`features-pg.test.ts:58`](libs/shared/src/project/features/features-pg.test.ts#L58), [`features-pg.test.ts:95`](libs/shared/src/project/features/features-pg.test.ts#L98), [`features-pg.test.ts:112`](libs/shared/src/project/features/features-pg.test.ts#L115), [`features-pg.test.ts:139`](libs/shared/src/project/features/features-pg.test.ts#L142), [`features-pg.test.ts:148`](libs/shared/src/project/features/features-pg.test.ts#L151), [`features-pg.test.ts:168`](libs/shared/src/project/features/features-pg.test.ts#L171), [`features-pg.test.ts:178`](libs/shared/src/project/features/features-pg.test.ts#L181), [`features.test.ts:45`](libs/shared/src/project/features/features.test.ts#L45), [`features.test.ts:52`](libs/shared/src/project/features/features.test.ts#L52), [`features.test.ts:62`](libs/shared/src/project/features/features.test.ts#L62), [`features.test.ts:72`](libs/shared/src/project/features/features.test.ts#L72), [`features-port.test.ts:28`](libs/shared/src/project/features/features-port.test.ts#L33), [`features-port.test.ts:34`](libs/shared/src/project/features/features-port.test.ts#L39), [`features-port.test.ts:48`](libs/shared/src/project/features/features-port.test.ts#L52), [`features-port.test.ts:58`](libs/shared/src/project/features/features-port.test.ts#L62), [`features-port.test.ts:68`](libs/shared/src/project/features/features-port.test.ts#L72))
- FR-20.9: Feature planning recovery orphans a running round older than
  the window (even while the runtime reports active), leaves a recent
  active round alone, no-ops when a ready round already moved the feature
  out of `planning` or there are no iterations, and keys on the latest
  iteration so a newer ready round supersedes an older running one; the
  round-in-flight helper returns a recent running iteration and null when
  the only running one is orphaned or none is running. ([validated by `planning-recovery.test.ts:49`](libs/shared/src/project/features/planning-recovery.test.ts#L50), [`planning-recovery.test.ts:68`](libs/shared/src/project/features/planning-recovery.test.ts#L69), [`planning-recovery.test.ts:98`](libs/shared/src/project/features/planning-recovery.test.ts#L99), [`planning-recovery.test.ts:111`](libs/shared/src/project/features/planning-recovery.test.ts#L112), [`planning-recovery.test.ts:131`](libs/shared/src/project/features/planning-recovery.test.ts#L132), [`round-in-flight.test.ts:26`](libs/shared/src/project/features/round-in-flight.test.ts#L27), [`round-in-flight.test.ts:38`](libs/shared/src/project/features/round-in-flight.test.ts#L39), [`round-in-flight.test.ts:48`](libs/shared/src/project/features/round-in-flight.test.ts#L49))
- FR-20.10: The `AgentRunner` port launches a Station via the injected
  `StationBackend` in cluster mode (passing the execution image, throwing
  when no provider is supplied) and calls the injected `LlmPort` in
  direct mode; agent execution refuses LOCAL mode on the shared server
  (`LORE_DB_HOST` set) yet allows cluster mode there. ([validated by `agent-runner.test.ts:33`](libs/shared/src/project/agents/agent-runner.test.ts#L33), [`agent-runner.test.ts:15`](libs/shared/src/project/agents/agent-runner.test.ts#L15), [`agent-runner.test.ts:70`](libs/shared/src/project/agents/agent-runner.test.ts#L100), [`agent-runner.test.ts:90`](libs/shared/src/project/agents/agent-runner.test.ts#L120), [`agent-runner.test.ts:114`](libs/shared/src/project/agents/agent-runner.test.ts#L144), [`agents.test.ts:22`](libs/shared/src/project/agents/agents.test.ts#L22), [`agents.test.ts:34`](libs/shared/src/project/agents/agents.test.ts#L34))
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
  ([validated by `agent-defs-port.test.ts:23`](libs/shared/src/project/agents/agent-defs-port.test.ts#L23), [`agent-defs-port.test.ts:27`](libs/shared/src/project/agents/agent-defs-port.test.ts#L27), [`agent-defs-port.test.ts:31`](libs/shared/src/project/agents/agent-defs-port.test.ts#L31), [`agent-defs-port.test.ts:67`](libs/shared/src/project/agents/agent-defs-port.test.ts#L67), [`agent-defs-pg.test.ts:101`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L101), [`agent-defs-pg.test.ts:110`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L110), [`agent-defs-pg.test.ts:122`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L122), [`agent-defs-pg.test.ts:138`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L138), [`agent-defs-pg.test.ts:165`](libs/shared/src/project/agents/agent-defs-pg.test.ts#L165), [`agent-defs-yaml.test.ts:43`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L42), [`agent-defs-yaml.test.ts:58`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L57), [`agent-defs-yaml.test.ts:68`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L67), [`agent-defs-yaml.test.ts:77`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L76), [`agent-defs-yaml.test.ts:109`](libs/shared/src/project/agents/agent-defs-yaml.test.ts#L110), [`agent-defs.test.ts:60`](libs/shared/src/project/agents/agent-defs.test.ts#L60), [`agent-defs.test.ts:68`](libs/shared/src/project/agents/agent-defs.test.ts#L68), [`agent-defs-http.test.ts:55`](libs/shared/src/project/agents/agent-defs-http.test.ts#L55), [`agent-defs-http.test.ts:64`](libs/shared/src/project/agents/agent-defs-http.test.ts#L64), [`agent-defs-http.test.ts:70`](libs/shared/src/project/agents/agent-defs-http.test.ts#L70))
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
  ([validated by `repo-files.test.ts:54`](libs/shared/src/project/repo/repo-files.test.ts#L55), [`repo-files.test.ts:60`](libs/shared/src/project/repo/repo-files.test.ts#L61), [`repo-files.test.ts:66`](libs/shared/src/project/repo/repo-files.test.ts#L67))
- FR-20.15: The `PullRequests` port lists only the repo's PRs, merges by
  number with the requested method, and exposes PR reads bound to the
  repo and number. ([validated by `pull-requests.test.ts:70`](libs/shared/src/project/pulls/pull-requests.test.ts#L70), [`pull-requests.test.ts:106`](libs/shared/src/project/pulls/pull-requests.test.ts#L106), [`pull-requests.test.ts:115`](libs/shared/src/project/pulls/pull-requests.test.ts#L115))
- FR-20.16: The `Issues` port returns the GitHubPort issues for the
  project's repo, creates an issue bound to the repo, and comments,
  closes, and labels by number bound to the repo. ([validated by `issues.test.ts:58`](libs/shared/src/project/issues/issues.test.ts#L59), [`issues.test.ts:102`](libs/shared/src/project/issues/issues.test.ts#L103), [`issues.test.ts:115`](libs/shared/src/project/issues/issues.test.ts#L116))
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
  out-of-window rows). ([validated by `usage-pg.test.ts:22`](libs/shared/src/project/usage/usage-pg.test.ts#L22), [`usage-pg.test.ts:48`](libs/shared/src/project/usage/usage-pg.test.ts#L51), [`usage-pg.test.ts:75`](libs/shared/src/project/usage/usage-pg.test.ts#L115), [`usage-pg.test.ts:90`](libs/shared/src/project/usage/usage-pg.test.ts#L130), [`usage-pg.test.ts:105`](libs/shared/src/project/usage/usage-pg.test.ts#L145), [`usage-pg.test.ts:121`](libs/shared/src/project/usage/usage-pg.test.ts#L161), [`usage-pg.test.ts:134`](libs/shared/src/project/usage/usage-pg.test.ts#L174), [`usage-pg.test.ts:151`](libs/shared/src/project/usage/usage-pg.test.ts#L191), [`usage-pg.test.ts:169`](libs/shared/src/project/usage/usage-pg.test.ts#L209), [`cost.test.ts:36`](libs/shared/src/project/cost/cost.test.ts#L36), [`cost.test.ts:60`](libs/shared/src/project/cost/cost.test.ts#L60), [`cost.test.ts:68`](libs/shared/src/project/cost/cost.test.ts#L68), [`cost.test.ts:80`](libs/shared/src/project/cost/cost.test.ts#L80), [`job-runs.test.ts:23`](libs/shared/src/project/job-runs/job-runs.test.ts#L23), [`job-runs.test.ts:36`](libs/shared/src/project/job-runs/job-runs.test.ts#L36), [`job-runs.test.ts:54`](libs/shared/src/project/job-runs/job-runs.test.ts#L54), [`job-runs.test.ts:62`](libs/shared/src/project/job-runs/job-runs.test.ts#L62), [`job-runs.test.ts:72`](libs/shared/src/project/job-runs/job-runs.test.ts#L72), [`job-runs.test.ts:86`](libs/shared/src/project/job-runs/job-runs.test.ts#L86), [`job-runs.test.ts:94`](libs/shared/src/project/job-runs/job-runs.test.ts#L94), [`job-runs.test.ts:104`](libs/shared/src/project/job-runs/job-runs.test.ts#L104), [`job-runs.test.ts:118`](libs/shared/src/project/job-runs/job-runs.test.ts#L118), [`job-runs.test.ts:131`](libs/shared/src/project/job-runs/job-runs.test.ts#L131), [`job-runs.test.ts:172`](libs/shared/src/project/job-runs/job-runs.test.ts#L172), [`evals.test.ts:23`](libs/shared/src/project/evals/evals.test.ts#L23), [`evals.test.ts:38`](libs/shared/src/project/evals/evals.test.ts#L38), [`evals.test.ts:48`](libs/shared/src/project/evals/evals.test.ts#L48), [`evals.test.ts:59`](libs/shared/src/project/evals/evals.test.ts#L59), [`evals.test.ts:81`](libs/shared/src/project/evals/evals.test.ts#L81), [`evals.test.ts:102`](libs/shared/src/project/evals/evals.test.ts#L102), [`evals.test.ts:123`](libs/shared/src/project/evals/evals.test.ts#L123), [`baseline.test.ts:23`](libs/shared/src/project/baseline/baseline.test.ts#L23), [`baseline.test.ts:46`](libs/shared/src/project/baseline/baseline.test.ts#L46), [`baseline.test.ts:64`](libs/shared/src/project/baseline/baseline.test.ts#L64), [`baseline.test.ts:78`](libs/shared/src/project/baseline/baseline.test.ts#L78), [`baseline.test.ts:92`](libs/shared/src/project/baseline/baseline.test.ts#L92), [`baseline.test.ts:125`](libs/shared/src/project/baseline/baseline.test.ts#L125))
- FR-20.18a: The in-memory `Usage` double mirrors the Pg write-time
  correlation as its behavioral spec: a seeded task id lands on `task_id`;
  a non-task id that matches a seeded assembly line falls back to
  `assembly_line_id`; an agent CR name resolves to the LAST registered
  node (the `ORDER BY n.id DESC LIMIT 1` lateral); an unknown-but-valid
  uuid with an unmatched CR stores the row uncorrelated (both ids null)
  instead of rejecting it — a non-uuid id is out of contract, erroring in
  Pg's `::uuid` cast; the write defaults (cost 0, status success, null
  error) apply; and
  `processedCounts` splits today (past local midnight) from total.
  ([validated by `usage-memory.test.ts:12`](libs/shared/src/project/usage/usage-memory.test.ts#L12), [`usage-memory.test.ts:25`](libs/shared/src/project/usage/usage-memory.test.ts#L25), [`usage-memory.test.ts:38`](libs/shared/src/project/usage/usage-memory.test.ts#L38), [`usage-memory.test.ts:49`](libs/shared/src/project/usage/usage-memory.test.ts#L89), [`usage-memory.test.ts:65`](libs/shared/src/project/usage/usage-memory.test.ts#L105), [`usage-memory.test.ts:79`](libs/shared/src/project/usage/usage-memory.test.ts#L119))
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
  - `PUT /api/repos/:o/:r/settings` on lore-api emits one
    `internal.repo.team_changed` event only when the write actually changes
    the team value (settings-only patches and same-value writes emit
    nothing), and a failed event insert degrades to the nightly relocation
    instead of failing the settings write that already happened. It REFUSES
    a patch touching a privileged dark-factory field (403, writing nothing
    at all) rather than merging it: that JSONB shares a column with the
    fields the CODEOWNER-approval ceremony guards, so a blanket merge here
    would be a way around that ceremony. The web-ui route forwards to it,
    normalizing a cleared team to null, and passes the refusal through
    with its status ([validated by forwards a team change to lore-api](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L37), [`route.test.ts:48`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L48), [`route.test.ts:56`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L56), [`route.test.ts:66`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L66), [`route.test.ts:81`](apps/web-ui/src/app/api/repos/[owner]/[repo]/settings/route.test.ts#L81), [`repo-settings.test.ts:39`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L39), [`repo-settings.test.ts:43`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L43), [`repo-settings.test.ts:51`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L51), [`repo-settings.test.ts:69`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L51), [`repo-settings.test.ts:86`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L74), [`repo-settings.test.ts:100`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L91), [`repo-settings.test.ts:118`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L105), [`repo-settings.test.ts:133`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L123), [`repo-settings.test.ts:147`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L138), [`repo-settings.test.ts:165`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L154), [`repo-settings.test.ts:182`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L174), [`repo-settings.test.ts:196`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L191), [`repo-settings.test.ts:74`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L74), [`repo-settings.test.ts:91`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L91), [`repo-settings.test.ts:105`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L105), [`repo-settings.test.ts:123`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L123), [`repo-settings.test.ts:138`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L138), [`repo-settings.test.ts:154`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L154), [`repo-settings.test.ts:174`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L174), [`repo-settings.test.ts:191`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L191), [`repo-settings.test.ts:205`](apps/lore-api/src/api/routes/repos/repo-settings.test.ts#L205), [`repos.test.ts:131`](apps/web-ui/src/lib/api/repos.test.ts#L131))
  - The Floor's `team_changed` handler re-reads the team from `lore.repos`
    rather than trusting the event payload, resolves it through the uncached
    single-sourced `chunkSchemaOrOrgShared` (never the per-repo memoized
    resolver, which would serve the pre-change schema for its TTL), no-ops
    when resolution falls back to `org_shared`, and lets a relocation error
    propagate so the event loop retries the idempotent move ([validated by `repo-team-changed.test.ts:47`](apps/floor/src/jobs/repo-team-changed.test.ts#L47), [`repo-team-changed.test.ts:66`](apps/floor/src/jobs/repo-team-changed.test.ts#L66), [`repo-team-changed.test.ts:81`](apps/floor/src/jobs/repo-team-changed.test.ts#L81), [`repo-team-changed.test.ts:89`](apps/floor/src/jobs/repo-team-changed.test.ts#L89), [`repo-team-changed.test.ts:102`](apps/floor/src/jobs/repo-team-changed.test.ts#L102))

## Non-Functional Requirements

### NFR-1: Security

- No long-lived credentials anywhere in the system. ([validated by `security-posture.test.ts:109`](libs/shared/src/infra-contract/security-posture.test.ts#L109), [`security-posture.test.ts:130`](libs/shared/src/infra-contract/security-posture.test.ts#L130))
- Workload Identity for all GKE workloads. ([validated by `security-posture.test.ts:101`](libs/shared/src/infra-contract/security-posture.test.ts#L101))
- Workload Identity Federation for GitHub Actions. ([validated by `security-posture.test.ts:126`](libs/shared/src/infra-contract/security-posture.test.ts#L126), [`security-posture.test.ts:130`](libs/shared/src/infra-contract/security-posture.test.ts#L130))
- Schema-per-team isolation in the vector store. ([validated by `chunks.test.ts:153`](libs/shared/src/project/chunks/chunks.test.ts#L153), [`chunks.test.ts:171`](libs/shared/src/project/chunks/chunks.test.ts#L171))
- Secret and PII redaction runs at ingest time and on every memory write:
  `sanitizeContent()` / `redactSecrets()` strip API keys, JWTs, private keys,
  connection strings, and bearer tokens before storage in the org-wide
  database. ([validated by `redact.test.ts:5`](libs/shared/src/redact.test.ts#L5), [`redact.test.ts:78`](libs/shared/src/redact.test.ts#L78))
- Centralized auth in `routes.ts`: every `/api/*` route enforces bearer
  token validation. Supports legacy single token (`LORE_INGEST_TOKEN`)
  and per-client scoped tokens with SHA-256 hashes. ([validated by `auth.test.ts:58`](apps/lore-api/src/api/routes/auth.test.ts#L58), [`bearer-scope.test.ts:45`](apps/lore-api/src/server/plugins/bearer-scope.test.ts#L45))
- Job pods run as non-root (uid 1000), drop all Linux capabilities,
  disallow privilege escalation. NetworkPolicy restricts egress to
  DNS + HTTPS + internal Lore API only. ([validated by `security-posture.test.ts:73`](libs/shared/src/infra-contract/security-posture.test.ts#L73), [`security-posture.test.ts:78`](libs/shared/src/infra-contract/security-posture.test.ts#L78), [`security-posture.test.ts:86`](libs/shared/src/infra-contract/security-posture.test.ts#L86), [`security-posture.test.ts:92`](libs/shared/src/infra-contract/security-posture.test.ts#L92))
- Rate limiting: 30/min webhooks, 60/min task ops, 200/min other
  (in-memory sliding window). 1 MB body size limit. ([validated by `rate-limit.test.ts:42`](apps/lore-api/src/server/plugins/rate-limit.test.ts#L42), [`auth.test.ts:19`](apps/lore-api/src/api/routes/auth.test.ts#L19), [`webhook-incident.test.ts:144`](apps/lore-api/src/api/routes/webhooks/webhook-incident.test.ts#L144))
- Slack indexing opt-in per channel only; DMs never indexed. ([validated by `notify-slack.test.ts:16`](libs/shared/src/project/notify/notify-slack.test.ts#L16), [`notify-decision.test.ts:35`](libs/shared/src/project/notify/notify-decision.test.ts#L35))

### NFR-2: Reliability & Freshness

- `lore_assemble_context` warns when repo context is stale (>7 days since
  last ingest) or missing (first-run welcome with suggested actions). ([validated by `context-freshness.test.ts:9`](libs/shared/src/project/knowledge/context-freshness.test.ts#L9), [`context-freshness.test.ts:15`](libs/shared/src/project/knowledge/context-freshness.test.ts#L15), [`context-freshness.test.ts:21`](libs/shared/src/project/knowledge/context-freshness.test.ts#L21), [`context-freshness.test.ts:25`](libs/shared/src/project/knowledge/context-freshness.test.ts#L25), [`context-freshness.test.ts:31`](libs/shared/src/project/knowledge/context-freshness.test.ts#L31))
- When the MCP server is unreachable, Claude Code MUST fall back to
  the last-synced local copy of CLAUDE.md files and ADRs in
  `~/.re-cinq/lore` and display a one-time warning to the developer
  that search quality may be degraded. Semantic search is unavailable
  in this mode; convention and ADR lookups continue from local files. ([validated by `context-tools.test.ts:62`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L62), [`context-tools.test.ts:108`](apps/mcp-server/src/mcp/tools/context-tools.test.ts#L108))

## Operational Targets & Constraints (Background)

The targets and deployment constraints below are operational context rather
than unit-tested behaviour; they are tracked here for the platform team and
enforced by benchmarking, infrastructure configuration, and review process.

**Performance targets (aspirational).**

- Context search returns results in under 200ms (p99) once
  infrastructure is deployed. **Note (2026-03-28):** Hybrid search
  (Vertex AI embedding + HNSW + BM25 + RRF) is functional end-to-end
  but p99 latency has not been benchmarked yet. The 200ms target
  remains aspirational until measured under load.
- Install script completes in under 5 minutes.
- Session start context sync completes in under 5 seconds.
- Incremental ingestion completes within 5 minutes of a merge.

**Reliability posture.**

- Install script is idempotent with no side effects on re-run.
- Platform hooks fail silently rather than blocking developer work.
- Health check script diagnoses all connection issues with fix
  instructions.
- Agent deployments do NOT affect running Job pods — tasks survive
  rollout restarts.

**Scalability and infrastructure.**

- CloudNativePG (CNPG) PostgreSQL instance on existing shared GKE
  cluster (`your-gke-cluster`, `europe-west1`). Scale up CNPG resource
  requests when query latency p99 exceeds 50ms. Upgrade path to
  AlloyDB Omni or managed AlloyDB if needed.
- GKE cluster is shared — Lore workloads run in dedicated namespaces
  (`mcp-servers`, `lore-agent`, `lore-ui`) on the existing cluster.
- Revisit vector store choice only if corpus exceeds 100M vectors.

**Governance.**

- Root CLAUDE.md changes require broad review (platform-eng +
  tech-leads).
- Team CLAUDE.md files owned by respective teams.
- ADR changes require arch-group + affected team review.
- Architecture decisions changed only via superseding ADR with
  full alternatives-rejected documentation.

## Clarifications

**Session 2026-03-25**

- Q: What happens when the MCP server is unreachable during a developer session? → A: Fall back to local `~/.re-cinq/lore` files with a one-time warning that search quality is degraded.
- Q: What happens to ingested chunks when their source is deleted, reverted, or superseded? → A: Hard delete. Nightly re-index removes chunks whose source no longer exists. No stale content retained.
- Q: How are concurrent task claims resolved? → A: `SELECT ... FOR UPDATE SKIP LOCKED` — atomic, no versioning overhead. Claim attempt on taken task returns immediate error.
- Q: What happens when a Lore Agent Job pod fails mid-task? → A: Fail immediately, update pipeline task with error reason, post Slack notification if channel mapped. No automatic retry — developer decides whether to resubmit via `lore_retry_task`.
- Q: How does the PR check transition from warning to enforcement mode? → A: Manual flip by platform team via CI config flag. No automatic date-based cutoff.

**Session 2026-04-13 (spec update)**

- Q: Why was Beads replaced? → A: Beads + Dolt had integration complexity and `bd` CLI instability. Pipeline tasks in PostgreSQL provide atomic claiming, dependency tracking, and full audit history without an external CLI dependency. (ADR-009)
- Q: How does the Lore Agent service run tasks? → A: A TypeScript worker in the `lore-agent` namespace polls the `pipeline.tasks` table and dispatches by task type. Simple tasks (onboard, feature-request, graph-ingest) run in-process via direct Anthropic API calls and the worker creates the PR. Complex tasks (implementation, general, review) run in ephemeral `claude-runner` Job pods created via the LoreTask CRD, with pre-run context hydration, deterministic validation, and full lifecycle control. (ADR-007)
- Q: Why no Graphiti / FalkorDB? → A: PostgreSQL-backed live knowledge graph provides the same traversable fact store without an additional graph database dependency. (ADR-010)
- Q: Why no OCI Context Cores? → A: DB-cached context assembly with the `lore_assemble_context` tool provides equivalent freshness guarantees without OCI registry infrastructure overhead. (ADR-010)

**Session 2026-04-20 (spec update — ADR-015 + post-April-13 work)**

- Q: Why switch from cron-polling to webhooks for the review reactor? → A: Polling every 5 minutes burned API quota and GitHub rate-limit budget on ticks that did nothing. Webhooks fire only on actual PR state changes; review latency drops from avg ~2.5 min to seconds. (ADR-015)
- Q: Why keep the safety-net cron at all? → A: A dropped webhook delivery stalls a PR until a human notices. A business-hours safety cron is nearly free and catches stragglers. Off-hours ticks are a pure waste so the cron is gated by `isBusinessHours()`. (ADR-015)
- Q: Why was the context budget cut from 16K to 8K by default? → A: Implementation and review flows only need conventions + the immediate diff. 16K was over-sending context and paying unnecessary token costs. Research keeps 16K because it needs broad memory coverage. (ADR-015)
- Q: Why prompt-cache at the system + tool-schema boundary separately? → A: A tool-schema edit would otherwise bust the system-prompt cache entry. Separate breakpoints ensure each can be reused independently. (ADR-015)
- Q: What is the `LORE_WEBHOOK_SECRET` latent bug that ADR-015 fixed? → A: The secret existed in GCP Secret Manager and had an ExternalSecret CR, but was never mounted into the mcp-server pod. `handleGitHubWebhook` always returned `503 "webhook secret not configured"`. ADR-015 mounted the secret and the webhook path now validates HMAC signatures correctly.
- Q: Why add `FR-18` (stuck-task recovery) now? → A: Job pods that exit without writing a terminal status left tasks stuck in `running` forever. The loretask-watcher had no mechanism to detect this until the `stale_task_check` hourly job was added (commit f203952, 2026-04-20).

## Scope & Out of Scope

**In Scope**

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
- Web UI (`/onboard`, pipeline status, task logs, analytics, knowledge graph, gaps). ([validated by `GapsView.test.tsx:26`](apps/web-ui/src/app/gaps/GapsView.test.tsx#L26), [`GraphView.test.tsx:35`](apps/web-ui/src/app/graph/GraphView.test.tsx#L35), [`AnalyticsView.test.tsx:116`](apps/web-ui/src/app/analytics/AnalyticsView.test.tsx#L116), [`TaskLogs.test.tsx:152`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L152), [`OnboardView.test.tsx:8`](apps/web-ui/src/app/onboard/OnboardView.test.tsx#L8))
- Spec drift detection (Phase 2).
- Prompt caching on agent LLM calls (ADR-015).
- Per-template context budgets (ADR-015).
- Stuck-task terminal-state recovery (`stale_task_check` job).

**Out of Scope**

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

## Background: Dependencies

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

## Background: Assumptions

- Developers have Node.js, Python (with uv or pip), and Git installed.
- All product repos are on GitHub within the Acme organization.
- Teams are willing to adopt the PR description template.
- The platform engineering team serves as the Phase 0 pilot.
- Existing ADRs and team conventions can be written up in MADR
  format within Phase 0.
- GCP infrastructure provisioning is approved and budgeted for
  Phase 1.

## Success Criteria (Goals & Non-Goals)

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
