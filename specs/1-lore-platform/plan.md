# Implementation Plan: Lore Platform

| Field        | Value                                           |
|--------------|-------------------------------------------------|
| Feature      | Lore — Shared Context Infrastructure            |
| Branch       | 1-lore-platform                                 |
| Spec         | [spec.md](spec.md)                              |
| Constitution | [constitution.md](../../.specify/memory/constitution.md) |
| Status       | Phase 1 Operational — hybrid search verified    |
| Created      | 2026-03-25                                      |

## Technical Context

### Stack

| Layer              | Technology                       | Phase |
|--------------------|----------------------------------|-------|
| MCP Server         | TypeScript + `@modelcontextprotocol/sdk` | 0     |
| Glue Scripts       | Python (lore-gen-constitution)   | 0     |
| Settings Merge     | Node.js (lore-merge-settings.js) | 0     |
| Health Check       | Bash (lore-doctor.sh)            | 0     |
| Install            | Bash (install.sh)                | 0     |
| Platform Skills    | Markdown (lore-feature.md, lore-pr.md) | 0  |
| PR CI Check        | GitHub Actions YAML              | 0     |
| Vector Store       | PostgreSQL + pgvector (CNPG on GKE, europe-west1) | 1 |
| Cluster Agents     | Lore Agent on GKE                | 1     |
| Observability      | OpenTelemetry → Cloud Monitoring  | 1    |
| CI Evals           | PromptFoo                        | 1     |
| Infrastructure     | CNPG operator + K8s manifests + CronJobs | 1     |
| Task Sync          | Pipeline tasks via PostgreSQL    | 2     |
| Knowledge Graph    | Graphiti + FalkorDB                | 3     |
| Context Cores      | OCI bundles via Artifact Registry  | 3     |
| Self-Improvement   | Autoresearch loop (Lore Agent job) -- IMPLEMENTED | 3     |
| Code Parsing       | web-tree-sitter (WASM)           | 1     |

### Key Dependencies

| Dependency              | Purpose                          | Risk |
|-------------------------|----------------------------------|------|
| `@modelcontextprotocol/sdk` | MCP server framework          | Low — stable, well-documented |
| `specify-cli`           | Spec Kit CLI                     | Medium — newer tool |
| CloudNativePG (CNPG)    | PostgreSQL operator + pgvector   | Low — mature CNCF operator |
| OpenTelemetry + Cloud Monitoring | Trace observability     | Low — native GCP, free tier |
| PromptFoo               | CI eval framework                | Low — mature, good GH Actions support |

### Repository Structure

```
re-cinq/lore/
├── CLAUDE.md
├── AGENTS.md
├── CODEOWNERS
├── adrs/
├── runbooks/
├── teams/
│   ├── payments/CLAUDE.md
│   ├── platform/CLAUDE.md
│   ├── mobile/CLAUDE.md
│   └── data/CLAUDE.md
├── evals/
├── mcp-server/
│   ├── src/index.ts
│   ├── package.json
│   └── Dockerfile
├── scripts/
│   ├── install.sh
│   ├── lore-gen-constitution.py
│   ├── lore-tasks-to-beads.py
│   ├── lore-merge-settings.js
│   └── lore-doctor.sh
├── .claude/
│   └── skills/
│       ├── lore-feature.md
│       └── lore-pr.md
├── k8s/                    # K8s manifests (CNPG, Klaus, MCP, Dolt, CronJobs)
├── .github/
│   ├── workflows/
│   │   ├── pr-description-check.yml
│   │   ├── ingest-context.yml
│   │   ├── context-evals.yml
│   │   └── gap-detection.yml
│   └── PULL_REQUEST_TEMPLATE.md
```

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| P1: DX-First Delivery | PASS | Phase 0 delivers full DX with zero infra. Gate enforced before Phase 1. |
| P2: Zero Stored Credentials | PASS | Phase 0 uses no credentials. Phase 1 uses Workload Identity exclusively. |
| P3: PR Quality Gates | PASS | PR template + CI check deployed in Phase 0 Day 1. |
| P4: Three-Command Interface | PASS | `bd ready`, `/lore-feature`, `/lore-pr` — all delivered in Phase 0. |
| P5: Single Interface (Lore MCP) | PASS | MCP server is the only developer-facing interface. Klaus accessed only via MCP delegation. |
| P6: Distributed Ownership | PASS | CODEOWNERS enforced. PromptFoo evals owned by teams. |
| P7: Architecture Final | PASS | Plan uses all decided technologies. No alternatives proposed. |
| P8: Schema-Per-Team | PASS | Phase 1 PostgreSQL (CNPG) uses schema-per-team. Phase 0 simulates via file directories. |
| P9: Agents Over Scripts | PASS | Phase 1 replaces all Python scripts with Klaus agents. |
| P10: Opt-In Data | PASS | Slack indexing opt-in only. PII classifier at ingest. |

No constitution violations. All gates pass.

## Implementation Phases

### Phase 0: Developer Experience (Days 1-4)

Phase 0 is the critical path. Every subsequent phase depends on its
success. The ordering below reflects dependencies — each day builds
on the previous.

#### Day 1: Foundation

**Deliverables:**
1. Create `re-cinq/lore` GitHub repository.
2. Write root `CLAUDE.md` (architecture contracts, code conventions,
   key services — under 2 pages).
3. Write `teams/payments/CLAUDE.md` (richest existing conventions:
   ADR-042 minor units, PCI scope, idempotency patterns).
4. Write `teams/platform/CLAUDE.md`.
5. Write 3 ADRs in MADR format with YAML frontmatter (use existing
   real decisions).
6. Write 2 runbooks from actual incidents.
7. Write `CODEOWNERS` with ownership boundaries.
8. Deploy `PULL_REQUEST_TEMPLATE.md` to all product repos.
9. Deploy `pr-description-check.yml` GitHub Action (warning mode).

**Dependencies:** None — this is pure content creation.

**Verification:**
- CLAUDE.md files render correctly and are under 2 pages each.
- ADR frontmatter validates against schema.
- PR template appears on new PRs in product repos.
- CI check runs and warns on empty sections.

#### Day 2: MCP Server + Install + Beads

**Deliverables:**
1. MVP MCP server (`mcp-server/src/index.ts`, ~80 lines):
   - `get_context(team?)` — reads org + team CLAUDE.md from disk.
   - `get_adrs(domain?, status?)` — reads and filters ADR files.
   - `search_context(query, team?, limit?)` — naive text search
     across all content files.
   - Falls back gracefully if files missing.
2. `install.sh`:
   - Clone `re-cinq/lore` to `~/.re-cinq/lore` (or pull if exists).
   - `npm install && npm run build` in mcp-server/.
   - Detect team via `git config --global lore.team`.
   - Run `lore-merge-settings.js` to configure Claude Code.
   - Install platform skills to `~/.claude/skills/`.
   - Install `@beads/bd` and `specify-cli`.
   - Run `bd init` in `~/.re-cinq/lore`.
   - Run `lore-doctor.sh`.
   - Idempotent — safe to re-run.
3. `lore-merge-settings.js` (~40 lines):
   - Reads existing `~/.claude/settings.json`.
   - Merges platform MCP config, env vars, hooks.
   - Never overwrites personal hooks.
   - Idempotent — detects existing lore hooks.
4. `AGENTS.md` with proactive guidance instructions.

**Dependencies:** Day 1 content (CLAUDE.md, ADRs) must exist for
MCP server to serve.

**Verification:**
- `install.sh` completes in under 5 minutes on clean machine.
- MCP server starts and `tools/list` returns 3 tools.
- `get_context("payments")` returns payments team conventions.
- `get_adrs(domain="payments")` returns ADR-042.
- `search_context("error handling")` returns relevant results.
- `bd --version` works.
- `lore-doctor` prints all green.

#### Day 3: Glue Scripts + Hooks + Skills

**Deliverables:**
1. `lore-gen-constitution.py` (~60 lines):
   - Calls MCP `get_context(team)` and `get_adrs(domain=team)`.
   - Renders `.specify/constitution.md`.
   - Handles: MCP not running, missing team, existing file.
2. `lore-tasks-to-beads.py` (~80 lines):
   - Parses Spec Kit `tasks.md`.
   - Calls `bd create` for each task.
   - Calls `bd dep add` for `[DEPENDS ON: ...]` markers.
   - Handles: `bd` not installed, file not found, duplicates.
3. `lore-doctor.sh` (~40 lines):
   - Tests: MCP server responds, `get_context` returns data,
     `bd` installed, `specify` installed, git connectivity,
     platform hooks present, platform skills present.
   - Prints pass/fail with fix instructions.
4. Platform hooks (in `lore-merge-settings.js`):
   - `SessionStart`: pull context repo + Beads state silently.
   - `PostToolUse` (Write/Edit/MultiEdit): mark claimed task
     in-progress.
   - `Stop`: remind about open claimed tasks.
5. Platform skills:
   - `lore-feature.md`: full spec-driven loop. Claude Code asks
     one question, then runs constitution -> specify -> tasks ->
     Beads wiring. Developer confirms at 3 decision points only.
   - `lore-pr.md`: reads Beads task + spec + diff + ADRs, drafts
     complete PR description. Developer reviews once.

**Dependencies:** Day 2 MCP server + install.sh must work.

**Verification:**
- `lore-gen-constitution --team payments` produces valid constitution
  from real ADRs.
- `lore-tasks-to-beads .specify/tasks.md` creates Beads tasks with
  correct dependencies.
- SessionStart hook pulls silently (no visible output on success).
- PostToolUse hook updates task progress on file edit.
- `/lore-feature` runs the full loop interactively.
- `/lore-pr` drafts a description from context.
- `lore-doctor` tests all of the above.

#### Day 4: Integration + Pilot

**Deliverables:**
1. End-to-end pilot run by platform engineering team:
   - Fresh machine install via `curl | bash`.
   - `lore-gen-constitution --team platform`.
   - `/speckit.specify` for a real feature.
   - `/speckit.tasks` to generate tasks.
   - `lore-tasks-to-beads` to wire tasks.
   - `bd ready` to see tasks.
   - Implement one task.
   - `/lore-pr` to draft PR description.
2. Fix any friction discovered during pilot.
3. Document any workarounds or known issues.

**Dependencies:** All Day 1-3 deliverables.

**Verification (Phase 0 Gate):**
- Full loop completes in under 30 minutes.
- Developer speaks fewer than 10 words during `/lore-feature`.
- `lore-doctor` all green on pilot machine.
- PR description has all sections populated.
- No manual context loading required at any point.

### Phase 1: Managed Infrastructure (Weeks 2-3)

Phase 1 deployed onto the existing shared GKE cluster `n8n-cluster`
in `europe-west1` — no new cluster was provisioned. All infrastructure
is Kubernetes-native (CNPG operator, K8s CronJobs, K8s Deployments).
No Terraform, no Cloud SQL, no Cloud Scheduler, no Langfuse, no
BigQuery.

#### Week 2: Infrastructure + Klaus

1. **Infrastructure provisioning:**
   - Existing GKE cluster `n8n-cluster` in `europe-west1` (shared
     cluster, already running).
   - CNPG operator already installed on cluster.
   - CNPG Cluster resource deployed: PostgreSQL 16 with `pgvector`
     extension, namespace `alloydb`, pod `lore-db-1`.
   - 5 schemas: `payments`, `platform`, `mobile`, `data`,
     `org_shared`.
   - Chunks table with `VECTOR(768)` embedding column, HNSW index
     (`lists = 100, m = 16, ef_construction = 64`),
     GIN index on `search_tsv`.
   - Workload Identity bindings per MCP server.

2. **Klaus deployment:**
   - Built from source (`giantswarm/klaus`), pushed to
     `ghcr.io/re-cinq/klaus:latest`.
   - Deployed in GKE `klaus` namespace, port 8080.
   - Configured with real Anthropic API key.
   - Workload Identity: write to PostgreSQL ingestion schemas +
     read GitHub API.

3. **Lore MCP server deployment:**
   - Built and pushed to `ghcr.io/re-cinq/lore-mcp:latest`.
   - Deployed in GKE `mcp-servers` namespace.
   - HTTP transport on `:3000/mcp` (GKE), stdio transport for
     local dev — selected via `MCP_TRANSPORT` env var.
   - Connected to PostgreSQL (CNPG) + Klaus + Cloud Monitoring
     via OTEL.
   - `delegate_task(task, context?, priority?)` — packages context
     bundle, submits to Klaus HTTP endpoint.
   - `task_status(task_id)` — polls Klaus.
   - `task_result(task_id)` — retrieves completed output.
   - `list_cluster_tasks()` — shows running tasks.
   - `buildContextBundle()` (~80 lines) — packages Beads task +
     spec + PostgreSQL seed chunks + branch.

4. **Dolt remote deployment:**
   - Deployed in GKE `dolt` namespace as `dolt-sql-server`.
   - Used for Beads task sync across developers.

5. **AGENTS.md update:** add delegation guidance (when to delegate,
   when not to, always pass context).

#### Week 3: MCP Upgrade + Observability + Evals

1. **MCP server PostgreSQL upgrade:**
   - Replace file reads with PostgreSQL (CNPG) queries.
   - `search_context` → hybrid search (HNSW vector + BM25 keyword,
     Reciprocal Rank Fusion).
   - `get_context` → query PostgreSQL `org_shared` + team schema.
   - `get_adrs` → query with status/domain filters.
   - Add `get_file_pr_history(file_path)`.
   - Add degraded-mode fallback (local files + warning).
   - No interface changes — `install.sh` re-run updates seamlessly.

2. **CronJobs in `klaus` namespace (replacing Cloud Scheduler):**
   - Nightly full re-index: CronJob at 2am UTC →
     `delegate_task` to Klaus. Hard-delete stale chunks.
   - Weekly gap detection: CronJob Monday 9am UTC →
     `delegate_task` to Klaus.
   - Weekly spec drift: CronJob Monday 10am UTC →
     `delegate_task` to Klaus.
   - Incremental ingest: GitHub Actions on-push webhook triggers
     `delegate_task` to Klaus.

3. **OpenTelemetry instrumentation (built into MCP server):**
   - OTEL SDK integrated directly into the Lore MCP server.
   - Traces + metrics exported to Cloud Monitoring.
   - `tracedSearch()` wrapper emits OTEL spans for every MCP retrieval call.
   - Low-confidence threshold tagging (initial: 0.72) as OTEL span
     attributes + Cloud Monitoring custom metric (`lore/gap_candidates`).
   - Cloud Monitoring dashboards: retrieval latency p99, gap candidate
     rate, query volume per namespace.
   - No Langfuse — OTEL to Cloud Monitoring is sufficient.

4. **PromptFoo CI evals:**
   - `evals/<team>/promptfooconfig.yaml` per team (5-10 cases).
   - `context-evals.yml` triggered on ADR/CLAUDE.md/spec changes.
   - `--assert-pass-rate 0.85` merge gate.

**Phase 1 Verification:**
- `search_context("error handling patterns")` returns relevant
  results in < 200ms p99.
- Merge a PR → within 5 minutes, Claude Code can answer why that
  approach was chosen.
- `search_context("ChargeBuilder idempotency")` returns code chunk
  (vector) + PR (keyword).
- Re-run `install.sh` — no workflow changes, better context quality.
- Cloud Monitoring shows retrieval latency p99 per namespace. Low-confidence tagged.
- PR changing CLAUDE.md to "store amounts as floats" fails CI.
- Hybrid search verified end-to-end: Workload Identity → Vertex AI
  text-embedding-005 → PostgreSQL HNSW + BM25 → RRF ranked results.
  Query "how does the lore platform work" returns plan.md, spec.md,
  platform CLAUDE.md as top results.
- Dedicated `lore` DB user (not the CNPG-managed `postgres` user) for
  cross-namespace access — bypasses CNPG reconciliation of password.
- Embeddings generated via `scripts/infra/generate-embeddings.sh`
  using Vertex AI text-embedding-005 (768 dimensions).
- 46 chunks seeded from clean repo after `lore-init` replaced
  fictional Acme content with re-cinq skeleton.

### Phase 2: Feedback Loop (Weeks 4-5)

Dolt remote and gap detection CronJob were deployed as part of
Phase 1, reducing Phase 2 scope.

1. **Dolt remote (deployed in Phase 1):**
   - Self-hosted `dolt-sql-server` in GKE `dolt` namespace (no
     DoltHub dependency).
   - Remote added to `install.sh`.
   - Auto-pull in `.zshrc`/`.bashrc`.
   - Optimistic locking with version counter for concurrent claims.

2. **Spec file ingestion:**
   - Instruct Klaus nightly agent to include `.specify/` files.
   - Content type: `spec`, subtypes: `constitution`, `spec`, `tasks`.

3. **Spec evals in CI:**
   - Add `.specify/**` to `context-evals.yml` trigger paths.

4. **Gap detection Klaus agent (CronJob deployed in Phase 1):**
   - CronJob Monday 9am UTC in `klaus` namespace →
     `delegate_task`.
   - Agent queries Cloud Monitoring for gap candidate metrics.
   - Clusters by embedding similarity.
   - For 3+ occurrence clusters: drafts content, opens PR to
     `re-cinq/lore`, labels `context-gap-draft`, assigns team.
   - Human review required.

**Phase 2 Verification:**
- `bd pull` syncs task state across developers.
- Concurrent `bd update --claim` on same task: one succeeds, one
  gets version conflict error.
- Gap detection opens a PR with specific, actionable drafted content.
- Spec files appear in `search_context` results.

### Phase 3: Knowledge Graph, Context Cores, and Self-Improvement (Weeks 6-10)

#### Week 6: Ontology + Graphiti

1. **Lore ontology definition:**
   - 8 entity types: Service, Team, Function, PR, ADR, Spec, Concept, Runbook.
   - 15 relationship types: OWNS, CALLS, IMPLEMENTS, SUPERSEDES, REFERENCES,
     AUTHORED_BY, DEFINES, VIOLATES, DERIVED_FROM, PART_OF, VALID_FROM,
     VALID_UNTIL, and others.
   - Write as a config file consumed by Graphiti during entity extraction.
   - Must be defined before Graphiti runs.

2. **Graphiti deployment:**
   - GKE `graphiti` namespace.
   - FalkorDB as the graph backend (lighter than Neo4j).
   - Graphiti MCP server: exposes graph search + entity history as MCP tools.
   - Ingests from PostgreSQL (CNPG) after each Klaus ingest job.
   - Incremental updates — no full re-index needed.

3. **Lore MCP tools (Graphiti proxy):**
   - `graph_search(query, depth)` — proxies to Graphiti MCP for multi-hop traversal.
   - `get_entity_history(entity)` — returns temporal history of an entity.
   - Replace the existing local-JSON-based graph.ts implementation.

#### Week 7: Context Cores

1. **Context Core manifest format:**
   - `lore-core.json`: version, namespace, source commit, ontology version,
     chunk count, eval score, provenance, promoted_by.
   - Stored as OCI artifacts in Artifact Registry.

2. **Context Core builder (nightly Klaus agent):**
   - Builds candidate Core from latest PostgreSQL (CNPG) content.
   - Runs full PromptFoo eval suite against candidate.
   - Promotes if score improves by >= 2% over current version.
   - Discards and opens Beads task if score regresses.

3. **install.sh update:**
   - Pull latest promoted Context Core via `crane pull` instead of git clone.
   - Fallback to git clone for Phase 0-2 compatibility.

#### Week 8: Autoresearch Loop

1. **research-charter.md:**
   - Standing instructions for the context research org.
   - Defines: the eval metric (PromptFoo score), what good context looks like,
     entity types in scope, exclusions (no PII, no credentials, no strategy).
   - Platform engineers update this file to steer the research system.

2. **Autoresearch loop (weekly Klaus agent):**
   - For each gap cluster from Cloud Monitoring gap candidate metrics:
     Generate 3 candidate additions (direct, example-based, constraint-based).
   - Build candidate Context Core for each.
   - Evaluate against PromptFoo suite.
   - Best candidate promoted if score improves >= 2%.
   - Failed attempts logged to Cloud Monitoring, Beads task for manual review.
   - PRs labelled `context-experiment-passed`.

#### Week 9: Spec Drift + Graph Integration

1. **Spec drift detection:**
   - Weekly Klaus agent reads spec assertions, checks against code via tree-sitter.
   - Adds VIOLATES edges to Graphiti graph for queryable drift.
   - Creates Beads task if divergence > 20%.

#### Week 10: AgentDB Cache

1. **AgentDB local cache (optional):**
   - Optional prompt in install.sh (unchanged).

**Phase 3 Verification:**
- `graph_search("why does ChargeBuilder work this way?")` returns traversal chain
  through Graphiti: Function → PR → ADR → Concept.
- `get_entity_history("ADR-042")` returns full temporal history.
- Context Core promotion: nightly build improves eval score, auto-promotes.
- Autoresearch loop: generates candidate, evaluates, opens PR with score diff.
- Spec drift adds VIOLATES edges visible in graph queries.

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Beads CLI API changes | Medium | Medium | Pin version in install.sh, test in CI |
| Klaus HTTP API not stable | High | Medium | Abstract behind Lore MCP delegation layer |
| Low PR description quality despite template | High | Medium | Warning period + internal comms campaign |
| CNPG PostgreSQL cold-start latency | Medium | Low | Connection pooling, PgBouncer sidecar |
| Developer adoption friction | High | Medium | Phase 0 gate — fix friction before Phase 1 |
| PromptFoo eval false positives | Medium | Medium | Start with high-confidence cases, tune threshold |
| Graphiti + FalkorDB operational overhead | Medium | Medium | Start with FalkorDB (lighter than Neo4j), monitor resource usage |
| Context Core promotion false positives | Medium | Low | Require >= 2% improvement threshold, human review on all promoted PRs |

## Critical Path

```
PR template (Day 1)
  → ingestion quality (Phase 1)
    → semantic search quality (Phase 1)
      → context eval accuracy (Phase 1)
        → gap detection value (Phase 2)
```

Everything depends on PR description quality. Start the PR template
on Day 1. The 4-6 week lead time before Phase 1 ingestion is
non-negotiable.

## Generated Artifacts

- [research.md](research.md) — technology decisions and best practices
- [data-model.md](data-model.md) — entity definitions and relationships
- [contracts/mcp-tools.md](contracts/mcp-tools.md) — MCP tool interface contracts
