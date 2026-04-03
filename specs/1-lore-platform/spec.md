# Feature Specification: Lore — Shared Context Infrastructure

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | Lore Platform                              |
| Branch            | 1-lore-platform                            |
| Status            | Shipped                                    |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 3-4 working days                           |
| Full Stack Target | 6-8 weeks                                  |

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
   installs task tracking and spec tools, and runs a health check.
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
1. Developer invokes the feature-start command.
2. System asks what they want to build (one question).
3. System generates a project constitution from real ADRs and team
   conventions, shows it, asks for confirmation.
4. System generates a feature specification, shows it, asks for
   confirmation.
5. System generates a task breakdown, shows it, asks for
   confirmation.
6. System wires tasks into the task tracker.
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
1. Developer signals they are ready for review.
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
2. Developer asks Claude Code to delegate it to the cluster.
3. System packages the task context (Beads task, spec file, relevant
   context chunks, branch name) and submits it.
4. Developer continues local work while the cluster agent works
   independently.
5. Developer checks status and retrieves results when ready.

**Acceptance Criteria:**
- Task submission returns immediately with a tracking ID.
- Context bundle includes Beads task description, spec acceptance
  criteria, pre-fetched context chunks, and branch to clone.
- Developer can check task status and retrieve results without
  leaving Claude Code.
- The cluster agent's claimed task is visible in the shared task
  tracker — no duplicate work.

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

### Scenario 9: Graphiti Temporal Knowledge Graph Traversal (Phase 3)

**Actor:** Active Developer or Tech Lead

**Flow:**
1. Developer asks "why does the auth service work this way?"
2. System queries Graphiti to traverse temporal knowledge graph:
   code -> PR -> ADR -> RFC -> Slack thread, including when each
   fact became true and when it was superseded.
3. System presents the chain of reasoning across sources with
   temporal context.

**Acceptance Criteria:**
- Graphiti temporal queries follow typed relationships across content
  types (OWNS, CALLS, IMPLEMENTS, SUPERSEDES, etc.).
- `graph_search` returns multi-hop traversal results that vector
  search alone cannot answer.
- `get_entity_history` returns when facts became true and when they
  were superseded.
- Graph requires 3+ months of ingested content and 30+ ADRs before
  activation.

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
Code sessions.

- FR-2.1: `get_context(team?)` — returns org CLAUDE.md + team
  CLAUDE.md.
- FR-2.2: `get_adrs(domain?, status?)` — returns active ADRs for
  a domain.
- FR-2.3: `search_context(query, limit?)` — Phase 0: naive text
  match; Phase 1: hybrid vector + keyword search with Reciprocal
  Rank Fusion.
- FR-2.4: Phase 0 implementation is file-backed (~80 lines
  TypeScript), replaced in Phase 1 without interface changes.
- FR-2.5: Phase 1 adds cluster delegation tools: `delegate_task`,
  `task_status`, `task_result`, `list_cluster_tasks`.
- FR-2.6: Phase 1 adds `get_file_pr_history(file_path)`.
- FR-2.7: When a cluster agent fails (crash, timeout, OOM, node
  preemption), the system MUST mark the task as failed with a
  reason, release the Beads claim, and surface the failure via
  `task_status`. No automatic retry. The developer decides whether
  to resubmit.

### FR-3: Developer Onboarding

The system MUST provide a single-command install experience.

- FR-3.1: Install script clones the context repo, builds the MCP
  server, detects team, configures Claude Code settings, installs
  CLI tools, and runs health checks.
- FR-3.2: Install script is idempotent — re-running always produces
  correct state.
- FR-3.3: Install script works without pre-cloning the repository.
- FR-3.4: Settings merge (via helper script) appends platform hooks
  without overwriting personal developer hooks.
- FR-3.5: Health check script tests all connections and prints clear
  pass/fail with fix instructions for each.

### FR-4: Task Tracking Integration

The system MUST integrate Beads for agent-native task tracking.

- FR-4.1: `AGENTS.md` instructs Claude Code on task tracking
  commands and proactive guidance behavior.
- FR-4.2: Session start hook syncs task state automatically.
- FR-4.3: File edit hook marks claimed tasks as in-progress.
- FR-4.4: Session end hook reminds about open claimed tasks.
- FR-4.5: Glue script converts Spec Kit task output into Beads
  tasks with dependency relationships.
- FR-4.6: Phase 2 adds self-hosted Dolt remote (dolt sql-server with
  remotesapi on GKE) for multi-developer task sync. No DoltHub dependency.
- FR-4.7: Concurrent task claiming MUST use optimistic locking with
  a version counter. A `bd update --claim` is rejected if the task
  version has changed since it was last read. The developer or agent
  receives a clear error and must re-read before retrying.

### FR-5: Spec-Driven Feature Workflow

The system MUST provide an end-to-end feature workflow via platform
skills.

- FR-5.1: `/lore-feature` skill guides the full loop: constitution
  generation -> specification -> task breakdown -> Beads wiring.
- FR-5.2: `/lore-pr` skill drafts PR descriptions from spec, task
  context, and changed files.
- FR-5.3: Constitution generation script calls MCP to populate
  `.specify/constitution.md` with real ADRs and team conventions.
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
store via intelligent agents.

- FR-7.1: Fast path: on-push to main triggers incremental ingestion
  via cluster agent.
- FR-7.2: Full path: nightly job triggers complete re-index via
  cluster agent.
- FR-7.3: Content types: code (AST-split), pull requests (diff +
  description + comments), ADRs, docs (section-chunked), specs,
  runbooks.
- FR-7.4: PII classifier runs at ingest time; sensitive content
  excluded from general search.
- FR-7.5: Cluster agents understand context semantically — they
  draft missing content and open PRs, not just chunk and embed.
- FR-7.6: Phase 2 adds spec file ingestion.
- FR-7.7: Nightly re-index MUST hard-delete chunks whose source
  file, PR, or ADR no longer exists or has been superseded. No
  stale content is retained.

### FR-8: Observability (Phase 1)

The system MUST provide observability into context retrieval quality.

- FR-8.1: All MCP retrieval calls traced via OpenTelemetry spans
  exported to Cloud Monitoring.
- FR-8.2: Low-confidence retrievals (score < threshold) tagged as
  gap candidates via OTEL span attributes and Cloud Monitoring
  custom metrics.
- FR-8.3: Gap signal feeds into Graphiti episodes in Phase 3 for
  automated context improvement.

### FR-9: Context Evaluation (Phase 1)

The system MUST validate context quality via CI.

- FR-9.1: PromptFoo eval suite with 5-10 test cases per team.
- FR-9.2: Teams own their eval cases.
- FR-9.3: Pass threshold: 85% required to merge.
- FR-9.4: Evals triggered on changes to ADRs, team CLAUDE.md files,
  root CLAUDE.md, and spec files.

### FR-10: Gap Detection (Phase 2)

The system MUST automatically identify and address knowledge gaps.

- FR-10.1: Weekly job analyzes low-confidence retrievals from the
  previous week.
- FR-10.2: Gaps clustered by embedding similarity.
- FR-10.3: For clusters with 3+ occurrences, cluster agent drafts
  the missing content.
- FR-10.4: Agent opens PRs to the context repo with drafted content,
  assigned to the relevant team.
- FR-10.5: Human review required before any auto-drafted content is
  merged.

### FR-11: Knowledge Graph (Phase 3)

The system MUST support temporal, traversable knowledge via Graphiti.

- FR-11.1: Graphiti deployed on GKE with FalkorDB backend, ingesting
  from PostgreSQL (CNPG) after each Klaus ingest job.
- FR-11.2: Explicit ontology with 8 entity types (Service, Team,
  Function, PR, ADR, Spec, Concept, Runbook) and 15 typed
  relationships (OWNS, CALLS, IMPLEMENTS, SUPERSEDES, REFERENCES,
  AUTHORED_BY, DEFINES, VIOLATES, DERIVED_FROM, PART_OF, VALID_FROM,
  VALID_UNTIL, plus others).
- FR-11.3: `graph_search(query, depth)` MCP tool proxies to Graphiti
  MCP server for multi-hop traversal.
- FR-11.4: `get_entity_history(entity)` MCP tool returns temporal
  history (when facts became true, when superseded).
- FR-11.5: Prerequisites: 3+ months of ingested PRs, 30+ ADRs.
  Ontology must be defined before Graphiti runs.

### FR-12: Spec Drift Detection (Phase 3)

The system MUST detect when specifications diverge from implementation.

- FR-12.1: Weekly job reads spec assertions and checks against
  current code via AST analysis.
- FR-12.2: Divergence above 20% of assertions triggers a task for
  the owning team.
- FR-12.3: Test files and generated files are excluded.

### FR-13: Context Cores (Phase 3)

The system MUST distribute context as versioned, evaluated OCI bundles.

- FR-13.1: Nightly Klaus agent builds a candidate Context Core from
  latest PostgreSQL content.
- FR-13.2: Candidate Core runs full PromptFoo eval suite.
- FR-13.3: If eval score improves by >= 2% over current version, Core
  is promoted to Artifact Registry. If score regresses, Core is
  discarded and a Beads task is opened.
- FR-13.4: Core manifest includes: version, namespace, source commit,
  ontology version, chunk count, eval score, provenance (ADRs, PR
  count, Confluence pages).
- FR-13.5: Developer machines and Klaus agents pull the latest promoted
  Core on SessionStart (with fallback to git clone for Phase 0-2).

### FR-14: Self-Improvement Loop (Phase 3)

The system MUST autonomously generate, evaluate, and promote context
improvements.

- FR-14.1: Weekly Klaus agent generates 3 candidate additions for each
  gap cluster (direct statement, example-based, constraint-based).
- FR-14.2: Each candidate is built into a Context Core and evaluated
  against the full PromptFoo suite.
- FR-14.3: Best candidate promoted if it improves score by >= 2%.
  If no candidate passes, all attempts logged to Cloud Monitoring and
  a Beads task opened for manual intervention.
- FR-14.4: `research-charter.md` defines the standing instructions:
  metric definition, good context criteria, entity scope, exclusions
  (no PII, no credentials, no forward-looking strategy).
- FR-14.5: Human review required only for candidates that pass the
  eval bar. PRs labelled `context-experiment-passed`.

## Non-Functional Requirements

### NFR-1: Security

- No long-lived credentials anywhere in the system.
- Workload Identity for all GKE workloads.
- Workload Identity Federation for GitHub Actions.
- Schema-per-team isolation in the vector store.
- PII classification at ingest time.
- `identity-service` schema has additional IAM restrictions.
- Security runbooks marked `sensitivity=internal`.
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

### NFR-4: Scalability

- CNPG PostgreSQL instance on existing shared GKE cluster
  (`n8n-cluster`, `europe-west1`). Scale up CNPG resource requests
  when query latency p99 exceeds 50ms. Upgrade path to AlloyDB Omni
  or managed AlloyDB if needed.
- GKE cluster is shared — Lore workloads run in dedicated namespaces
  (`mcp-servers`, `alloydb`, `klaus`, `dolt`) on the existing cluster.
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
- Q: How are concurrent Beads task claims resolved? → A: Optimistic locking with version counter. Claim rejected if version changed since last read.
- Q: What happens when a Klaus agent fails mid-task? → A: Fail immediately, release Beads claim, store failure reason. No automatic retry — developer decides whether to resubmit.
- Q: How does the PR check transition from warning to enforcement mode? → A: Manual flip by platform team via CI config flag. No automatic date-based cutoff.

## Scope Boundaries

### In Scope

- Context repository structure and content.
- MCP server (file-backed Phase 0, PostgreSQL/pgvector-backed Phase 1+).
- Developer onboarding (install script, health check, settings
  merge).
- Task tracking integration (Beads + AGENTS.md + hooks).
- Spec-driven feature workflow (skills + glue scripts).
- PR quality enforcement (template + CI check).
- Ingestion pipeline (Klaus agents in GKE).
- Observability (OpenTelemetry + Cloud Monitoring).
- Context evaluation (PromptFoo CI gate).
- Gap detection (automated drafting + PR opening).
- Knowledge graph (Graphiti, Phase 3).
- Context Cores (OCI bundles, Phase 3).
- Self-improvement loop (Phase 3).
- Spec drift detection (Phase 3).

### Out of Scope

- Chatbot or internal AI assistant product.
- Replacement for GitHub Issues, Jira, or project management tools.
- Documentation platform (indexes existing docs, does not replace).
- Surveillance tooling (opt-in only, no DMs).
- Custom agent orchestration frameworks — use native Claude Code
  Agent Teams for local work, Klaus for cluster work.
- Cross-team spec coordination beyond ADR patterns and Beads
  dependency links.

## Dependencies

- Claude Code v2.1.32+ (Agent Teams support).
- GCP project with existing GKE cluster (`n8n-cluster`,
  `europe-west1`) and Cloud Monitoring access (Phase 1+).
- CloudNativePG operator (CNPG) on GKE (Phase 1+, already installed
  on shared cluster).
- Vertex AI `text-embedding-005` for 768-dim embeddings (Phase 1+).
  Auth via Workload Identity — `lore-mcp-server` GCP SA with
  `aiplatform.user` role, bound to `default` SA in `mcp-servers`
  namespace. No API keys.
- GitHub organization with Actions, CODEOWNERS, and PR template
  support.
- Beads CLI (`@beads/bd`).
- Spec Kit CLI (`specify-cli`).
- PromptFoo (Phase 1+).
- Dolt (self-hosted `dolt-sql-server` on GKE, Phase 1+).
- Klaus (`ghcr.io/re-cinq/klaus:latest`, Phase 1+).
- Anthropic API key (for Klaus, Phase 1+).
- Graphiti (Phase 3).
- FalkorDB (Phase 3).
- OCI/crane tooling (Phase 3).

## Assumptions

- Developers have Node.js, Python (with uv), and Git installed.
- All product repos are on GitHub within the Acme organization.
- Teams are willing to adopt the PR description template.
- The platform engineering team serves as the Phase 0 pilot.
- Existing ADRs and team conventions can be written up in MADR
  format within Phase 0.
- GCP infrastructure provisioning is approved and budgeted for
  Phase 1.
- Beads and Spec Kit CLIs are stable enough for production use.

## Success Criteria

1. A new developer goes from zero to a fully configured Claude Code
   environment in under 5 minutes with a single command.
2. Developers complete the full feature loop (constitution -> spec
   -> tasks -> implementation -> PR) without memorizing the sequence.
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
