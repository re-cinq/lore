# Implementation Plan: Lore Platform

| Field        | Value                                           |
|--------------|-------------------------------------------------|
| Feature      | Lore — Shared Context Infrastructure            |
| Branch       | 1-lore-platform                                 |
| Spec         | [spec.md](spec.md)                              |
| Constitution | [constitution.md](../../.specify/memory/constitution.md) |
| Status       | Draft                                           |
| Created      | 2026-03-25                                      |

## Technical Context

### Stack

| Layer              | Technology                       | Phase |
|--------------------|----------------------------------|-------|
| MCP Server         | TypeScript + `@modelcontextprotocol/sdk` | 0     |
| Glue Scripts       | Python (acme-gen-constitution, acme-tasks-to-beads) | 0 |
| Settings Merge     | Node.js (acme-merge-settings.js) | 0     |
| Health Check       | Bash (acme-doctor.sh)            | 0     |
| Install            | Bash (install.sh)                | 0     |
| Platform Skills    | Markdown (acme-feature.md, acme-pr.md) | 0  |
| PR CI Check        | GitHub Actions YAML              | 0     |
| Vector Store       | AlloyDB AI (europe-west4)        | 1     |
| Cluster Agents     | Klaus on GKE                     | 1     |
| Observability      | Langfuse (self-hosted) + BigQuery | 1    |
| CI Evals           | PromptFoo                        | 1     |
| Infrastructure     | Terraform                        | 1     |
| Task Sync          | Dolt (self-hosted on GKE)        | 2     |
| Knowledge Graph    | Graphiti + FalkorDB                | 3     |
| Context Cores      | OCI bundles via Artifact Registry  | 3     |
| Self-Improvement   | Autoresearch loop (Klaus agent)    | 3     |

### Key Dependencies

| Dependency              | Purpose                          | Risk |
|-------------------------|----------------------------------|------|
| `@modelcontextprotocol/sdk` | MCP server framework          | Low — stable, well-documented |
| `@beads/bd`             | Agent task tracking CLI          | Medium — newer tool, API may evolve |
| `specify-cli`           | Spec Kit CLI                     | Medium — newer tool |
| Klaus (`giantswarm/klaus`) | Cluster agent runtime         | Medium — requires GKE, Phase 1 |
| AlloyDB AI              | Vector store + embedding         | Low — managed GCP service |
| Langfuse                | Trace observability              | Low — mature OSS, Helm chart |
| PromptFoo               | CI eval framework                | Low — mature, good GH Actions support |

### Repository Structure

```
acme/context/
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
│   ├── acme-gen-constitution.py
│   ├── acme-tasks-to-beads.py
│   ├── acme-merge-settings.js
│   └── acme-doctor.sh
├── .claude/
│   └── skills/
│       ├── acme-feature.md
│       └── acme-pr.md
├── terraform/
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
| P4: Three-Command Interface | PASS | `bd ready`, `/acme-feature`, `/acme-pr` — all delivered in Phase 0. |
| P5: Single Interface (Lore MCP) | PASS | MCP server is the only developer-facing interface. Klaus accessed only via MCP delegation. |
| P6: Distributed Ownership | PASS | CODEOWNERS enforced. PromptFoo evals owned by teams. |
| P7: Architecture Final | PASS | Plan uses all decided technologies. No alternatives proposed. |
| P8: Schema-Per-Team | PASS | Phase 1 AlloyDB uses schema-per-team. Phase 0 simulates via file directories. |
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
1. Create `acme/context` GitHub repository.
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
   - Clone `acme/context` to `~/.acme/context` (or pull if exists).
   - `npm install && npm run build` in mcp-server/.
   - Detect team via `git config --global acme.team`.
   - Run `acme-merge-settings.js` to configure Claude Code.
   - Install platform skills to `~/.claude/skills/`.
   - Install `@beads/bd` and `specify-cli`.
   - Run `bd init` in `~/.acme/context`.
   - Run `acme-doctor.sh`.
   - Idempotent — safe to re-run.
3. `acme-merge-settings.js` (~40 lines):
   - Reads existing `~/.claude/settings.json`.
   - Merges platform MCP config, env vars, hooks.
   - Never overwrites personal hooks.
   - Idempotent — detects existing acme hooks.
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
- `acme-doctor` prints all green.

#### Day 3: Glue Scripts + Hooks + Skills

**Deliverables:**
1. `acme-gen-constitution.py` (~60 lines):
   - Calls MCP `get_context(team)` and `get_adrs(domain=team)`.
   - Renders `.specify/constitution.md`.
   - Handles: MCP not running, missing team, existing file.
2. `acme-tasks-to-beads.py` (~80 lines):
   - Parses Spec Kit `tasks.md`.
   - Calls `bd create` for each task.
   - Calls `bd dep add` for `[DEPENDS ON: ...]` markers.
   - Handles: `bd` not installed, file not found, duplicates.
3. `acme-doctor.sh` (~40 lines):
   - Tests: MCP server responds, `get_context` returns data,
     `bd` installed, `specify` installed, git connectivity,
     platform hooks present, platform skills present.
   - Prints pass/fail with fix instructions.
4. Platform hooks (in `acme-merge-settings.js`):
   - `SessionStart`: pull context repo + Beads state silently.
   - `PostToolUse` (Write/Edit/MultiEdit): mark claimed task
     in-progress.
   - `Stop`: remind about open claimed tasks.
5. Platform skills:
   - `acme-feature.md`: full spec-driven loop. Claude Code asks
     one question, then runs constitution -> specify -> tasks ->
     Beads wiring. Developer confirms at 3 decision points only.
   - `acme-pr.md`: reads Beads task + spec + diff + ADRs, drafts
     complete PR description. Developer reviews once.

**Dependencies:** Day 2 MCP server + install.sh must work.

**Verification:**
- `acme-gen-constitution --team payments` produces valid constitution
  from real ADRs.
- `acme-tasks-to-beads .specify/tasks.md` creates Beads tasks with
  correct dependencies.
- SessionStart hook pulls silently (no visible output on success).
- PostToolUse hook updates task progress on file edit.
- `/acme-feature` runs the full loop interactively.
- `/acme-pr` drafts a description from context.
- `acme-doctor` tests all of the above.

#### Day 4: Integration + Pilot

**Deliverables:**
1. End-to-end pilot run by platform engineering team:
   - Fresh machine install via `curl | bash`.
   - `acme-gen-constitution --team platform`.
   - `/speckit.specify` for a real feature.
   - `/speckit.tasks` to generate tasks.
   - `acme-tasks-to-beads` to wire tasks.
   - `bd ready` to see tasks.
   - Implement one task.
   - `/acme-pr` to draft PR description.
2. Fix any friction discovered during pilot.
3. Document any workarounds or known issues.

**Dependencies:** All Day 1-3 deliverables.

**Verification (Phase 0 Gate):**
- Full loop completes in under 30 minutes.
- Developer speaks fewer than 10 words during `/acme-feature`.
- `acme-doctor` all green on pilot machine.
- PR description has all sections populated.
- No manual context loading required at any point.

### Phase 1: Managed Infrastructure (Weeks 2-3)

#### Week 2: Infrastructure + Klaus

1. **Terraform provisioning:**
   - AlloyDB cluster (Enterprise, `europe-west4`,
     `db-perf-optimized-N-4`).
   - Extensions: `vector`, `alloydb_scann`,
     `google_ml_integration`.
   - Schema per team: `payments`, `platform`, `mobile`, `data`,
     `org_shared`.
   - Chunks table with `VECTOR(768)` embedding column, ScaNN index,
     GIN index on `search_tsv`.
   - GKE cluster (`acme-ai-platform`, private, regional).
   - Node pools: `mcp-pool` (n2-standard-4, 2-6),
     `general` (n2-standard-2, 2-8).
   - Namespaces: `mcp-servers`, `langfuse`, `klaus`.
   - Workload Identity bindings per MCP server.
   - Cloud SQL (postgres-15) for Langfuse metadata.
   - BigQuery dataset: `acme_platform_traces`.
   - Cloud Storage bucket: `acme-langfuse-media`.

2. **Klaus deployment:**
   - Helm chart in GKE `klaus` namespace.
   - HTTP MCP endpoint for task submission.
   - Workload Identity: write to AlloyDB ingestion schemas +
     read GitHub API.

3. **Lore MCP server — Klaus client module (~200 lines TS):**
   - `delegate_task(task, context?, priority?)` — packages context
     bundle, submits to Klaus HTTP endpoint.
   - `task_status(task_id)` — polls Klaus.
   - `task_result(task_id)` — retrieves completed output.
   - `list_cluster_tasks()` — shows running tasks.
   - `buildContextBundle()` (~80 lines) — packages Beads task +
     spec + AlloyDB seed chunks + branch.

4. **AGENTS.md update:** add delegation guidance (when to delegate,
   when not to, always pass context).

#### Week 3: MCP Upgrade + Observability + Evals

1. **MCP server AlloyDB upgrade:**
   - Replace file reads with AlloyDB queries.
   - `search_context` → hybrid search (ScaNN vector + BM25 keyword,
     Reciprocal Rank Fusion).
   - `get_context` → query `org_shared` + team schema.
   - `get_adrs` → query with status/domain filters.
   - Add `get_file_pr_history(file_path)`.
   - Add degraded-mode fallback (local files + warning).
   - No interface changes — `install.sh` re-run updates seamlessly.

2. **Cloud Scheduler jobs → Klaus:**
   - Incremental ingest: GitHub Actions on-push webhook triggers
     `delegate_task` to Klaus.
   - Nightly full re-index: Cloud Scheduler 2am →
     `delegate_task` to Klaus.
   - Hard-delete stale chunks during nightly re-index.

3. **Langfuse deployment:**
   - Helm chart on GKE, `langfuse` namespace.
   - Cloud SQL Auth Proxy sidecar.
   - BigQuery export integration.
   - OIDC → Google Workspace SSO.
   - `tracedSearch()` wrapper in MCP server.
   - Low-confidence threshold tagging (initial: 0.72).

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
- Langfuse shows all retrieval traces. Low-confidence tagged.
- PR changing CLAUDE.md to "store amounts as floats" fails CI.

### Phase 2: Feedback Loop (Weeks 4-5)

1. **Dolt remote (~1 hour):**
   - Create DoltHub `acme/beads-tasks`.
   - Add remote to `install.sh`.
   - Auto-pull in `.zshrc`/`.bashrc`.
   - Optimistic locking with version counter for concurrent claims.

2. **Spec file ingestion:**
   - Instruct Klaus nightly agent to include `.specify/` files.
   - Content type: `spec`, subtypes: `constitution`, `spec`, `tasks`.

3. **Spec evals in CI:**
   - Add `.specify/**` to `context-evals.yml` trigger paths.

4. **Gap detection Klaus agent:**
   - Cloud Scheduler Monday 9am UTC → `delegate_task`.
   - Agent queries BigQuery for gap traces.
   - Clusters by embedding similarity.
   - For 3+ occurrence clusters: drafts content, opens PR to
     `acme/context`, labels `context-gap-draft`, assigns team.
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
   - Ingests from AlloyDB change stream after each Klaus ingest job.
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
   - Builds candidate Core from latest AlloyDB content.
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
   - For each gap cluster from Langfuse traces:
     Generate 3 candidate additions (direct, example-based, constraint-based).
   - Build candidate Context Core for each.
   - Evaluate against PromptFoo suite.
   - Best candidate promoted if score improves >= 2%.
   - Failed attempts logged to BigQuery, Beads task for manual review.
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
| AlloyDB cold-start latency | Medium | Low | Connection pooling, keep-alive |
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
