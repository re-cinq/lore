<!--
Sync Impact Report
- Version: 1.3.0 (MINOR — updated commands, agents, tech stack, phase milestones)
- Modified: Principle 4, 9 — updated commands and agent jobs; Phase 1, 3 — removed Klaus, marked implementations
- Added principles:
  1. DX-First Delivery
  2. Zero Stored Credentials
  3. PR Description Quality Gates Ingestion
  4. Three-Command Developer Interface
  5. Single Interface (Lore MCP)
  6. Distributed Ownership with CI Eval Gates
  7. Architecture Decisions Are Final
  8. Schema-Per-Team Isolation
  9. Intelligent Agents Over Mechanical Scripts
  10. Opt-In Data Collection
- Templates requiring updates: N/A (initial creation)
- Follow-up TODOs: None
-->

# Project Constitution

| Field | Value |
|---|---|
| Project | Lore |
| Subtitle | Shared context infrastructure for Claude Code |
| Constitution Version | 1.3.0 |
| Ratification Date | 2026-03-25 |
| Last Amended Date | 2026-04-01 |

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
agents (Klaus) directly — they talk to the Lore MCP server, which
delegates on their behalf.

MCP tools fall into two categories:
- Context retrieval: `get_context`, `get_adrs`, `search_context`,
  `get_file_pr_history`.
- Cluster delegation: `delegate_task`, `task_status`, `task_result`,
  `list_cluster_tasks`.

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
| MCP deployment | Per-team containers on GKE |
| Ingestion trigger | On-push (fast) + nightly (full) via K8s CronJobs |
| Observability | OpenTelemetry → Cloud Monitoring + Graphiti (gap signal) |
| Scheduling | Lore Agent built-in scheduler with DB persistence |
| GKE cluster | Existing shared `n8n-cluster` in `europe-west1` (not dedicated) |
| Task tracking | Pipeline tasks via Lore MCP + GH Issues |
| Governance | Distributed ownership + CI eval gate |
| Build sequence | DX-first: Phase 0 before infra |
| Multi-agent orchestration | Native Claude Code Agent Teams (local) + Lore Agent (cluster) |
| Context distribution format | Context Cores (versioned OCI bundles) |
| Knowledge graph | Graphiti (temporal, MCP-native) |
| Context ontology | Explicit 8-type schema (Phase 3) |
| Self-improvement loop | Autoresearch-style keep/discard against PromptFoo |

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
| Autoresearch | Finds knowledge gaps from Langfuse traces, generates candidates, opens PRs |
| Context core builder | Compares context quality to baseline, promotes improvements |

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

## Technology Stack

| Component | Technology |
|---|---|
| Vector store | PostgreSQL + pgvector (CNPG on GKE, `europe-west1`) |
| Embedding | Vertex AI `text-embedding-005` via application-level call |
| Vector index | HNSW (pgvector) |
| Search | Hybrid: HNSW vector + BM25 keyword, Reciprocal Rank Fusion |
| MCP server | TypeScript, per-team containers on GKE |
| Cluster agents | Lore Agent (`lore-agent` namespace, @anthropic-ai/sdk + Claude Code CLI) |
| Local orchestration | Claude Code Agent Teams (native) |
| Task tracking | Pipeline tasks via Lore MCP + GitHub Issues |
| Feature workflow | Spec Kit (`specify-cli`) |
| Observability | OpenTelemetry → Cloud Monitoring |
| CI evals | PromptFoo |
| Infrastructure | CNPG operator + K8s manifests + CronJobs (on existing shared GKE cluster `n8n-cluster`) |
| Auth | Workload Identity (GKE), Workload Identity Federation (GHA) |
| Code parsing | web-tree-sitter (TypeScript, Python, Go) |
| Document parsing | LlamaIndex readers (GitHub, Confluence) + unstructured |
| Knowledge graph | Graphiti (temporal context graph) + FalkorDB |

## Phased Delivery

### Phase 0: Developer Experience (3-4 working days, zero infra)

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
**Gate:** Pilot team completes a full feature loop naturally before
Phase 1 starts.

### Phase 1: Managed Infrastructure (~2 weeks) — DEPLOYED AND VERIFIED

Replace file-backed MCP with PostgreSQL + pgvector (CNPG). Wire up ingestion.
Deployed onto existing shared GKE cluster `n8n-cluster` in `europe-west1`.
Hybrid search verified end-to-end: Workload Identity → Vertex AI → PostgreSQL → RRF results.
Deliverables:
- CNPG Cluster resource (namespace `alloydb`, pod `lore-db-1`) +
  schema-per-team + HNSW indexes. Dedicated `lore` DB user (not
  `postgres`) for cross-namespace access — bypasses CNPG password
  reconciliation.
- Embeddings via Vertex AI `text-embedding-005` (768 dimensions),
  generated by `scripts/infra/generate-embeddings.sh`. 46 chunks
  seeded from clean repo after `lore-init`.
- Namespaces on shared cluster: `mcp-servers`, `alloydb`, `lore-agent`.
- Klaus (`ghcr.io/re-cinq/klaus:latest`) in `klaus` namespace, port 8080.
- Lore MCP server (`ghcr.io/re-cinq/lore-mcp:latest`) in `mcp-servers`
  namespace, HTTP transport on `:3000/mcp`.
- 3 CronJobs in `klaus` namespace: nightly reindex (2am), weekly gap
  detection (Mon 9am), weekly spec drift (Mon 10am).
- OpenTelemetry instrumentation built into MCP server → Cloud Monitoring.
- PromptFoo eval suite + CI gate.
- No Langfuse, no Cloud SQL, no BigQuery, no Cloud Scheduler, no Terraform.

**Gate:** Phase 1 acceptance criteria pass before Phase 2.

### Phase 2: Feedback Loop (~1.5 weeks)

Close the loop — system improves based on actual usage. Deliverables:
- Gap detection as Klaus agent (drafts content, opens PRs).
- Spec file ingestion into PostgreSQL.
- Spec evals in CI.

### Phase 3: Knowledge Graph, Context Cores, and Self-Improvement (3-4 weeks, after 3+ months of content)
- Lore ontology definition (8 entity types, 15 relationships).
- Graphiti deployment (GKE graphiti namespace + FalkorDB).
- `graph_search` + `get_entity_history` Lore MCP tools (Graphiti proxy).
- Context Core builder (nightly Lore Agent job: eval + promote/discard) — IMPLEMENTED.
- `research-charter.md` — standing instructions for the context research org.
- Autoresearch loop (weekly Lore Agent job: query Langfuse for low-confidence traces, generate candidates, eval against PromptFoo, promote or discard) — IMPLEMENTED.
- Spec drift detection with VIOLATES graph edges.
- AgentDB optional local cache.

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
