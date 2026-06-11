<!--
Sync Impact Report
- Version: 2.2.0 (MINOR — Dark Factory mode (ADR-016) + Principle 12 added; P7/P11 task-tracking narrowed)
- Modified: P7 decision table row "Task tracking" — narrows when GH Issues are created (now exception-surface only when dark-factory mode is enabled per repo)
- Modified: Technology stack row "Task tracking" — same narrowing reflected
- Added: ADR-016 reference (Dark Factory mode)
- Modified: Principle 5 — complete MCP tool list (memory, graph, episode tools added)
- Modified: Principle 7 — architecture decisions table updated to reflect ADR-015 and post-April-13 decisions
- Modified: Principle 9 — jobs table updated (review reactor, prompt cache analysis)
- Modified: Principle 11 — expanded with retrieval strengthening, PR outcome feedback, confidence tiers, conflict surfacing
- Added: Principle 12 (Event-Driven Automation over Polling)
- Updated: Technology stack — prompt caching, local runner, AgentDB, session tracker, token scopes
- Updated: Phase 3 description — cross-repo context, progressive trust, task groups, production awareness, per-template budgets
- Follow-up TODOs: pilot rollout against three trust-tiered repos (T059) before flipping dark-factory defaults

Previous (Version 2.1.0 — 2026-04-20, MINOR):
- Principle 12 added; Principles 5, 7, 9, 11 materially expanded

Previous (Version 2.0.0 — 2026-04-13, MAJOR):
- principles 5, 7, 9 materially redefined; technology stack and phases updated
- added P11 (Intelligent Memory Lifecycle)
- replaced the third-party agent runtime with the purpose-built Lore Agent service; removed Context Cores, Graphiti+FalkorDB references
-->

# Project Constitution

| Field | Value |
|---|---|
| Project | Lore |
| Subtitle | Shared context infrastructure for Claude Code |
| Constitution Version | 2.2.0 |
| Ratification Date | 2026-03-25 |
| Last Amended Date | 2026-04-28 |

## Purpose

Lore is the shared context infrastructure that makes Claude Code
organization-aware at Acme. Every developer opens Claude Code and it
already knows: org-wide conventions, team-specific patterns, active
architectural decisions, PR history and reasoning, and current sprint
context — without any manual loading. One install command. Everything
else automatic.

### What Lore is not

- Not a chatbot or internal AI assistant product.
- Not a replacement for GitHub Issues, Jira, or existing project
  management tools.
- Not a documentation platform — it indexes existing docs, it does
  not replace them.
- Not a surveillance tool — Slack indexing is opt-in per channel,
  DMs are never indexed.

## Principles

### Principle 1: DX-First Delivery

Phase 0 delivers working developer value with zero GCP infrastructure.
The workflow MUST be validated before investing in PostgreSQL and
Kubernetes. If developers do not naturally reach for the platform
tools within 5 working days of Phase 0 delivery, the friction MUST
be fixed before Phase 1 begins.

**Rationale:** Infrastructure without adoption is waste. Building the
developer experience first proves the workflow is valuable and
surfaces friction cheaply. The Phase 0 gate exists to prevent sunk
cost pressure from pushing a bad workflow into production infra.

### Principle 2: Zero Stored Credentials

No long-lived credentials anywhere in the system. This is a hard
requirement with no exceptions.

- PostgreSQL (CNPG) auth: Workload Identity for all GKE workloads.
- GitHub Actions: Workload Identity Federation.
- Cloud Monitoring: default GKE service account scoping.
- MCP server keys: scoped per team via IAM.

**Rationale:** Stored credentials rotate, leak, and become attack
surfaces. Workload Identity eliminates the entire class of credential
management problems. Every component MUST authenticate via identity
federation, not stored secrets.

### Principle 3: PR Description Quality Gates Ingestion

The entire ingestion pipeline quality depends on PR description
quality. The PR template MUST be enforced from day one — 4-6 weeks
of well-structured PRs are required before Phase 1 ingestion has
meaningful content.

Required PR sections:
- `## Why` — what problem this solves.
- `## Alternatives rejected` — what else was considered and why not.
  "N/A" is not acceptable.
- `## ADR references` — links to relevant ADRs.
- `## Spec` — link to `.specify/spec.md` if spec-driven.

CI enforcement: warning-only for the first 2 weeks, hard fail after.

**Rationale:** PR review threads are the highest-value content for
the context store. The alternatives-rejected section captures
decisions that would otherwise be lost forever. Without quality
descriptions, semantic search returns noise regardless of how good
the embedding model is.

### Principle 4: Three-Command Developer Interface

A developer MUST need to remember exactly three things:

```
ready_tasks (MCP) -> what should I work on right now?
/lore-feature     -> I'm starting something new
/lore-pr          -> I'm about to open a PR
```

Everything else — context sync, task state updates, spec generation,
PR description drafting — happens automatically or is
prompted by Claude Code. A developer MUST never need to read the full
platform spec to use the system correctly.

**Rationale:** Mental overhead kills adoption. Every additional command
or concept a developer must remember is friction that compounds across
the team. The platform succeeds when developers forget it exists and
just experience Claude Code being smarter.

### Principle 5: Single Interface (Lore MCP)

The Lore MCP server is the single interface for all context retrieval
and cluster delegation. Developers MUST NOT interact with cluster
agents (Lore Agent) directly — they talk to the Lore MCP server,
which delegates on their behalf.

MCP tools fall into three categories:
- Context retrieval: `assemble_context`, `search_context`,
  `search_memory`, `query_graph`, `get_file_pr_history`.
- Memory operations: `write_memory`, `read_memory`, `delete_memory`,
  `list_memories`, `write_episode`, `agent_stats`.
- Cluster delegation: `create_pipeline_task`, `get_pipeline_status`,
  `list_pipeline_tasks`, `cancel_task`, `retry_task`,
  `list_task_group`, `get_task_logs`, `my_usage`,
  `run_task_locally`, `list_local_tasks`, `cancel_local_task`.

**Rationale:** A single interface means one thing to configure, one
thing to debug, and one set of access controls. Exposing cluster
internals to developers creates coupling that makes the platform
harder to evolve.

### Principle 6: Distributed Ownership with CI Eval Gates

Content ownership is distributed to teams. Governance is enforced by
CI, not by a central team reviewing every change.

- Root `CLAUDE.md`: requires `@lore/platform-eng` +
  `@lore/tech-leads` review.
- `teams/<team>/CLAUDE.md`: owned by the respective team.
- `adrs/`: owned by `@lore/arch-group` + affected team.
- `runbooks/`: owned by the operating team.
- PromptFoo evals: each team owns their eval cases. Platform does
  not own domain knowledge.
- Pass threshold: `--assert-pass-rate 0.85` required to merge.

**Rationale:** Centralised review bottlenecks do not scale. CI eval
gates provide consistent quality enforcement without requiring a
platform team member in every review. Teams know their domain better
than platform does.

### Principle 7: Architecture Decisions Are Final

The following decisions have been made and MUST NOT be relitigated:

| Decision | Choice |
|---|---|
| Vector store | PostgreSQL + pgvector via CloudNativePG (CNPG) on GKE |
| Namespace model | Schema per team in PostgreSQL (CNPG) |
| MCP deployment | Single container in `mcp-servers` namespace on GKE |
| Ingestion trigger | On-push (fast) + nightly (full) via K8s CronJobs |
| Observability | OpenTelemetry → Cloud Monitoring |
| Scheduling | Lore Agent built-in scheduler with DB persistence |
| GKE cluster | Existing shared `your-gke-cluster` in `europe-west1` (not dedicated) |
| Task tracking | Pipeline tasks via Lore MCP; GH Issues for exception surfaces (opt-out per ADR-016) |
| Governance | Distributed ownership + CI eval gate |
| Build sequence | DX-first: Phase 0 before infra |
| Multi-agent orchestration | Lore Agent (direct API + headless Claude Code) on GKE |
| Task execution | LoreTask CRD → ephemeral K8s Job pods (claude-runner image) |
| Knowledge graph | PostgreSQL `memory.entities` + `memory.edges` tables (incremental, live) |
| Memory lifecycle | Importance decay (half-life model) + automatic fact consolidation (Haiku) |
| Privacy | `sanitizeContent()` / `redactSecrets()` on all memory writes before DB storage |
| Review reactor trigger | GitHub webhooks (event-driven) + business-hours safety cron — no idle polling (ADR-015) |
| Prompt caching | Two cache breakpoints per LLM call (system + tool schema); `LORE_CACHE_1H_JOBS` allowlist for 1 h TTL |
| Context budgets | Default 8K tokens; research template 16K; callers request more explicitly |
| Cross-repo context | Transfer-score filtering (portable vs local keywords, threshold ≥ 0.5); bidirectional link registration |
| Progressive trust | Per-repo trust level (`docs` → `tests` → `implementation` → `full`); auto-promotes after 3 merged tasks |
| API auth | Per-client scoped tokens (SHA-256, `pipeline.api_tokens`); scopes: read / write / task / webhook / admin |
| Rate limiting | In-memory sliding window: 30/min webhooks, 60/min task ops, 200/min other |
| Job pod security | Non-root uid 1000, drop all Linux caps, NetworkPolicy egress: DNS + HTTPS + Lore API only |

Upgrade path to AlloyDB Omni or managed AlloyDB if corpus exceeds ~10M vectors. Revisit Vertex AI Vector Search only if corpus exceeds ~100M vectors.

**Rationale:** Relitigating settled architecture decisions burns team
time without producing value. These decisions were made with full
context. The spec documents rejected alternatives and their reasons.
If new information genuinely invalidates a decision, propose an ADR
superseding the original.

### Principle 8: Schema-Per-Team Isolation

Each team has its own schema in PostgreSQL. An MCP server instance for
team X can read schema X + `org_shared`, never another team's schema.

Content types stored:
- `code`: functions/classes split at AST boundaries.
- `pull_request`: diff + description + all review comments.
- `adr`: decision records with status and domain tags.
- `doc`: Confluence/Notion pages chunked at section boundaries.
- `spec`: `.specify/` constitution + spec + tasks files.
- `runbook`: ops procedures, updated post-incident.

Sensitive content handling:
- `identity-service` schema has additional IAM restrictions.
- PII classifier runs at ingest time — chunks containing email
  addresses or card-like patterns get `sensitivity=restricted` and
  are excluded from general search.
- Security runbooks get `sensitivity=internal` — not accessible to
  external contractors.

**Rationale:** Schema isolation provides SQL-level access control
without a separate authorization layer. A `WHERE` clause is simpler,
faster, and more auditable than API-level filtering.

### Principle 9: Intelligent Agents Over Mechanical Scripts

Background and CI work that would traditionally be GitHub Actions
Python scripts MUST run as Lore Agent tasks in GKE. The critical
difference: Lore Agent (direct API + Claude Code headless) can read
code intelligently, understand PR context semantically, draft missing
content, and open PRs — a Python script can only chunk and embed
mechanically.

Platform jobs running as Lore Agent tasks:

| Job | What Lore Agent does beyond a script |
|---|---|
| Incremental ingest | Understands PR context, not just chunks it |
| Full re-index | Identifies stale chunks, drafts missing content |
| Gap detection | Drafts missing context and opens PRs |
| Spec drift check | Reads code + spec, writes the update needed |
| Eval runner | Runs PromptFoo nightly, detects regressions, creates tasks |
| Feature request | Generates spec.md, data-model.md, tasks.md from PM intent |
| Implementation | Implements from spec in ephemeral Job pod with lint/typecheck gate |
| Review | Reviews PR against conventions, posts comments, iterates up to 2 rounds |
| Memory decay | Scores and evicts low-importance memories (importance decay job, 5 AM) |
| Memory consolidation | Synthesizes higher-level patterns from recent facts (consolidation job, 5:30 AM) |
| Review reactor (webhook) | Fires on GitHub webhook events; runs `runReviewReactorForPR` in background; never gated |
| Review reactor (safety cron) | `7 7-17 * * 1-5` UTC; catches dropped webhook deliveries; gated by `isBusinessHours()` |
| Prompt cache analysis | Emits hit/miss/break classification per `jobName`; feeds cost accounting (1.25× writes, 0.1× reads) |
| PR outcome feedback | On merge: +5 `half_life_days` on contributing facts; on rejection: −3 (min 7) |

**Rationale:** The value of Lore is not in storing chunks — it is in
understanding context. Agents that can reason about what is missing,
stale, or contradictory produce a self-improving knowledge base.
Scripts produce a static one.

### Principle 10: Opt-In Data Collection

Slack indexing is opt-in per channel only. DMs are never indexed.
Consent MUST be recorded in the channel topic. The PII classifier
MUST run at ingest time on all content sources.

**Rationale:** Trust is a prerequisite for adoption. Developers who
fear surveillance will not write candid PR descriptions or Slack
discussions — destroying the quality of the exact content the system
depends on.

### Principle 11: Intelligent Memory Lifecycle

Memory MUST be bounded, fresh, and signal-dense. Six mechanisms
enforce this without agent cooperation:

1. **Passive capture** — MCP server tracks all tool calls in-memory
   (500-entry ring buffer). On process exit, dumps to
   `~/.lore/last-session.json`. Stop hook POSTs to
   `/api/session-summary` for automatic episode + fact extraction.
   No agent `write_episode` call required.

2. **Importance-based decay** — Daily job (5 AM) scores memories
   0-10 using a half-life decay model
   (`strength = 0.5^(age / half_life_days)`). Retrieval count,
   content richness, and key type factor into scoring. Evicts
   lowest-scoring memories beyond 500 per agent. Transitions
   unretrieved facts to `stale` confidence after 30 days.

3. **Automatic consolidation** — Daily job (5:30 AM) groups recent
   facts (7-day lookback, minimum 5 facts) by repo and calls Haiku
   to extract 1-3 higher-level patterns. Stored as
   `consolidated/{repo}/{timestamp}` memories. Turns noisy raw facts
   into actionable insights for future agents.

Facts carry a `confidence` column: `verified` (human-confirmed),
`observed` (episode-sourced), `inferred` (memory-sourced), `stale`
(unretrieved 30+ days). Search returns only valid facts by default
and includes confidence annotations. Stale facts receive a −1
importance penalty; retrieval revives them to `observed`. Contradicted
facts (cosine similarity ≥ 0.92 to a new fact) are automatically
invalidated before storage; conflicts are recorded in
`memory.fact_conflicts`. Context assembly prefixes `[CONFLICT]` on
facts with contradictions in the past 7 days.

4. **Retrieval strengthening** — Every `search_memory` call
   asynchronously increments `retrieval_count`, updates
   `last_retrieved_at`, and extends `half_life_days` (+2, cap 365)
   on returned facts and memories. Fire-and-forget; zero added latency.

5. **PR outcome feedback** — On PR merge, `half_life_days` is boosted
   (+5) on facts and memories whose IDs appear in
   `pipeline.tasks.context_refs` for that task. On
   closed-without-merge (rejection), the penalty is −3 (floor 7).
   Signals which context actually drove good outcomes.

6. **Session diversification** — RRF merge caps results at 3 per
   `agent_id + source` combo, preventing one verbose session from
   dominating search rankings.

**Rationale:** Unbounded memory growth degrades search quality and
increases cost. Agents that skip `write_episode` lose learnings
silently. Passive capture + bounded decay + consolidation + retrieval
strengthening + outcome feedback keeps memory useful and
self-improving without requiring explicit agent cooperation.

### Principle 12: Event-Driven Automation Over Polling

Background automation MUST be triggered by real events, not
scheduled polls. Polling burns API quota on ticks that do nothing
and introduces artificial latency.

**Pattern:**

1. **Primary trigger** — GitHub webhooks deliver state changes
   immediately. The MCP server receives webhook events and fans out
   to the relevant agent endpoint via HTTP POST with an internal
   bearer token (`LORE_AGENT_INTERNAL_TOKEN`). The agent returns
   `202 Accepted` and processes asynchronously.

2. **Safety net cron** — A low-frequency cron (`7 7-17 * * 1-5` UTC)
   catches any webhook deliveries that were dropped. It MUST be gated
   by `isBusinessHours()` — off-hours invocations no-op. Webhook-
   triggered runs MUST never be gated by business hours.

3. **No idle work** — A cron that fires unconditionally and performs
   meaningful work only 10% of the time is a polling loop in disguise.
   Either gate it (business hours, feature flag) or replace it with an
   event trigger.

Accepted webhook event types for review automation:
`pull_request` (synchronize / opened / reopened / ready_for_review),
`pull_request_review` (submitted), `issue_comment` (created on PRs).

**Rationale:** The original 5-min `review_reactor` cron burned GitHub
API rate-limit budget on most ticks without doing anything. Switching
to webhooks reduced average review latency from ~2.5 min to seconds
and eliminated idle API calls. The safety cron provides fault
tolerance without reinstating continuous polling. See ADR-015.

## Technology Stack

| Component | Technology |
|---|---|
| Vector store | PostgreSQL + pgvector (CNPG on GKE, `europe-west1`) |
| Embedding | Vertex AI `text-embedding-005` via application-level call |
| Vector index | HNSW (pgvector) |
| Search | Hybrid: HNSW vector + BM25 keyword, Reciprocal Rank Fusion |
| MCP server | TypeScript, single container in `mcp-servers` namespace |
| Cluster agents | Lore Agent (`lore-agent` namespace, @anthropic-ai/sdk + Claude Code CLI) |
| Task execution | LoreTask CRD → ephemeral K8s Job pods (claude-runner image) |
| Task tracking | Pipeline tasks via Lore MCP; GitHub Issues for exception surfaces (opt-out per ADR-016) |
| Feature workflow | Spec Kit (`specify-cli`) |
| Observability | OpenTelemetry → Cloud Monitoring |
| CI evals | PromptFoo |
| Infrastructure | CNPG operator + K8s manifests + CronJobs + LoreTask CRD (on existing shared GKE cluster `your-gke-cluster`) |
| Auth | Workload Identity (GKE), Workload Identity Federation (GHA) |
| Code parsing | web-tree-sitter (TypeScript, Python, Go) |
| Document parsing | LlamaIndex readers (GitHub, Confluence) + unstructured |
| Knowledge graph | PostgreSQL `memory.entities` + `memory.edges` (incremental updates on `write_episode`) |
| Memory lifecycle | `agent/src/jobs/memory-lifecycle.ts` — importance decay (Ebbinghaus model) + Haiku-driven consolidation |
| Privacy filtering | `@re-cinq/lore-shared` `redactSecrets()` — strips keys, JWTs, connection strings before memory writes |
| Prompt caching | `agent/src/lib/prompt-cache.ts` — `getCacheControl(jobName)` returns ephemeral (5m) or 1h breakpoints; `analyzeCacheBreak` classifies hit / first-call / break |
| Local task runner | `mcp-server/src/local-runner.ts` — worktree-based execution with `validateRepoMatch`; task state in `~/.lore/local-tasks.json` |
| Session tracker | `mcp-server/src/session-tracker.ts` — passive tool-call ring buffer (500 entries); exit dump + Stop hook POST |
| Local read cache | AgentDB optional local read cache when MCP runs in stdio mode (proxies writes to GKE backend) |
| API token scopes | `pipeline.api_tokens` — SHA-256 hashed per-client tokens; scopes: read / write / task / webhook / admin |
| Rate limiting | In-memory sliding window: 30/min webhooks, 60/min task ops, 200/min other; 1 MB body limit |

## Phased Delivery

### Phase 0: Developer Experience (3-4 working days, zero infra) — COMPLETE

Validate the workflow before investing in infrastructure. Deliverables:
- `re-cinq/lore` repo with CLAUDE.md hierarchy + ADRs + runbooks.
- MVP MCP server (file-backed, ~80 lines TypeScript).
- `install.sh` (idempotent, one-command onboarding).
- `lore-gen-constitution.py` glue script.
- `lore-doctor.sh` health check.
- `lore-merge-settings.js` for safe settings merging.
- Platform hooks (SessionStart, PostToolUse, Stop).
- Platform skills (`/lore-feature`, `/lore-pr`).
- PR template + CI description check in all product repos.

### Phase 1: Managed Infrastructure — DEPLOYED AND VERIFIED

Replace file-backed MCP with PostgreSQL + pgvector (CNPG). Wire up ingestion.
Deployed onto existing shared GKE cluster `your-gke-cluster` in `europe-west1`.
Hybrid search verified end-to-end: Workload Identity → Vertex AI → PostgreSQL → RRF results.
Deliverables:
- CNPG Cluster resource (namespace `lore-db`) + schema-per-team + HNSW indexes.
  Dedicated `lore` DB user (not `postgres`) for cross-namespace access.
- Embeddings via Vertex AI `text-embedding-005` (768 dimensions).
- Namespaces on shared cluster: `mcp-servers`, `lore-db`, `lore-agent`.
- Lore Agent (`ghcr.io/re-cinq/lore-agent:latest`) in `lore-agent` namespace.
- Lore MCP server (`ghcr.io/re-cinq/lore-mcp:latest`) in `mcp-servers`
  namespace, HTTP transport on `:3000/mcp`.
- LoreTask CRD + controller in `lore-agent` namespace. Ephemeral Job pods
  run `ghcr.io/re-cinq/claude-runner:latest`.
- CronJobs: nightly reindex (2 AM), weekly gap detection (Mon 9 AM),
  weekly spec drift (Mon 10 AM), daily importance decay (5 AM),
  daily consolidation (5:30 AM).
- OpenTelemetry instrumentation built into MCP server → Cloud Monitoring.
- PromptFoo eval suite + CI gate.

### Phase 2: Feedback Loop — IMPLEMENTED

Closed the loop — system improves based on actual usage. Deliverables:
- Gap detection as Lore Agent task (drafts content, opens PRs).
- Spec file ingestion into PostgreSQL.
- Spec evals in CI.
- Passive session capture (`session-tracker.ts` + Stop hook → `/api/session-summary`).
- Post-task auto-curation (`episode-writer.ts` with Haiku lesson extraction).
- Importance-based memory decay + automatic fact consolidation (`memory-lifecycle.ts`).
- Privacy filtering on all memory writes (`redactSecrets()`).
- Session diversification in search (max 3 results per agent_id + source combo in RRF).

### Phase 3: Knowledge Graph and Self-Improvement — IMPLEMENTED

Deliverables:
- Live knowledge graph (`memory.entities` + `memory.edges`) updated
  incrementally on every `write_episode` call.
- `query_graph` MCP tool for entity relationship queries.
- Autonomous review loop (opt-in per repo via `auto_review` setting) —
  review Job posts PR comments, iterates up to 2 rounds.
- PR outcome feedback: merge/rejection signals adjust fact `half_life_days`
  (+5 on merge, −3 on rejection, floor 7). Context refs tracked via
  `pipeline.tasks.context_refs`. Closed-without-merge detected as rejection.
- Retrieval strengthening: `search_memory` increments `retrieval_count`,
  updates `last_retrieved_at`, extends `half_life_days` (+2, cap 365)
  on returned facts and memories. Stale facts revive to `observed` on retrieval.
- Confidence tiers: `verified`, `observed`, `inferred`, `stale`.
- Conflict surfacing: `[CONFLICT]` prefix on facts with contradictions in the
  past 7 days.
- Cross-repo context: `settings.cross_repo_repos` bidirectional links.
  Transfer score filters portable content (threshold ≥ 0.5); local config
  and secrets are excluded automatically.
- Progressive trust: per-repo `settings.trust.level` (docs → tests →
  implementation → full). Auto-promotes after 3 successful merges. Defaults
  to `implementation` for backward compatibility.
- Task groups: `task_group_id` coordinates multi-repo features. Summary
  episode written when all tasks in a group merge.
- Production awareness: `settings.incidents` surfaced at priority 1 in
  `assemble_context`. Populated via `/api/webhook/incident`
  (PagerDuty / Opsgenie).
- Event-driven review reactor: webhook fan-out from mcp-server to agent's
  `POST /api/trigger/review-reactor`; business-hours safety cron catches
  dropped deliveries. See ADR-015.
- Prompt caching: two cache breakpoints per LLM call (system + tool schema);
  1h TTL allowlist via `LORE_CACHE_1H_JOBS`. Cost accounting at 1.25× writes,
  0.1× reads.
- Per-template context budgets: default 8K, research 16K. `assemble_context`
  `max_tokens` parameter default 8K.
- Context freshness: `assemble_context` warns on stale (>7 days) or missing
  context. `/api/repo-status` exposes `last_ingested_at` + `stale` flag.
- Spec drift detection with VIOLATES tracking.
- AgentDB optional local read cache (stdio mode).

## Governance

### Amendment Procedure

1. Propose changes via PR to `.specify/memory/constitution.md`.
2. Changes to principles require review from `@lore/platform-eng`.
3. Architecture decision changes require a superseding ADR with full
   alternatives-rejected documentation.
4. Version bumps follow semantic versioning:
   - MAJOR: principle removals or redefinitions.
   - MINOR: new principles or materially expanded guidance.
   - PATCH: clarifications, wording, typo fixes.

### Compliance Review

- PromptFoo CI evals enforce principle alignment on every PR that
  touches context files.
- Weekly gap detection surfaces areas where practice diverges from
  stated principles.
- Phase 0 gate and Phase 1 gate are hard stops — do not proceed
  without passing acceptance criteria.
