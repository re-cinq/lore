# Research: Lore Platform

## R1: MCP Server SDK (TypeScript)

**Decision:** Use `@modelcontextprotocol/sdk` with stdio transport
for Phase 0, upgrade to Streamable HTTP transport for Phase 1 GKE
deployment.

**Rationale:** The official MCP SDK is the canonical way to build
MCP servers. stdio transport is simplest for local development
(launched by Claude Code as a subprocess). Streamable HTTP is
required for GKE deployment where the server runs as a container
accessible over the network.

**Alternatives considered:**
- Custom HTTP server with MCP-compatible JSON-RPC: unnecessary
  complexity, no benefit over the SDK.
- Python MCP SDK: team's MCP server expertise is TypeScript, and
  the TS SDK is more mature.

**Best practices:**
- Define tools with Zod schemas for input validation.
- Use `server.tool()` registration pattern.
- Keep tool count minimal (3 in Phase 0, 7-8 in Phase 1).
- Return `{ content: [{ type: 'text', text: ... }] }` format.
- Handle errors gracefully — return error text, do not throw.

## R2: Beads Task Tracking (`@beads/bd`)

**Decision:** Use Beads as the agent-native task tracker with Dolt
as the persistence layer.

**Rationale:** Beads is designed for AI agent workflows — it
supports dependency graphs, atomic claiming, and integrates with
Dolt for distributed state. GitHub Issues lacks the agent-native
API surface (no `bd ready`, no dependency-based unblocking).

**Alternatives considered:**
- GitHub Issues only: no agent-native CLI, no dependency graph,
  no atomic claiming.
- Linear: good for humans, poor for agent automation without
  API overhead.

**Key API surface for glue scripts:**
```
bd init                          # initialize in a directory
bd create "title"                # create a task
bd dep add <child> <parent>      # add dependency
bd update <id> --claim           # claim a task
bd update <id> --status done     # mark complete
bd update <id> --progress        # mark in-progress
bd ready                         # list unblocked tasks
bd list --claimed --json         # JSON output of claimed tasks
bd show <id>                     # show task details
bd pull / bd push                # sync with Dolt remote
```

**Optimistic locking implementation:**
- Beads on Dolt stores a version counter per task row.
- `bd update --claim` reads current version, writes new version
  atomically.
- If version changed between read and write, Dolt merge conflict
  surfaces the error.
- The glue layer must catch this and present a clear error message.

## R3: Klaus Cluster Agents

**Decision:** Deploy Klaus on GKE as the cluster agent runtime,
accessible via Streamable HTTP MCP endpoint.

**Rationale:** Klaus runs Claude Code as a managed subprocess in
Kubernetes. It handles lifecycle management (start, stop, timeout),
resource limits, and exposes an HTTP API for task submission. This
is simpler than building a custom agent runtime.

**Alternatives considered:**
- GitHub Actions with Claude Code: no persistent state, cold start
  on every run, limited execution time.
- Custom Kubernetes Jobs: no MCP interface, no lifecycle management,
  more operational overhead.

**Deployment model:**
- Helm chart in `klaus` namespace.
- Each task gets a dedicated pod with resource limits.
- Tasks have configurable timeouts (default: 30 minutes).
- On failure: pod terminates, Klaus marks task as failed with
  reason, Beads claim released.
- HTTP endpoint: `POST /mcp` for Streamable HTTP MCP protocol.

**Klaus task lifecycle:**
```
submitted → running → completed
                   → failed (reason stored)
                   → timed_out (treated as failure)
```

## R4: AlloyDB AI (Phase 1)

**Decision:** AlloyDB AI with `text-embedding-005` via `embedding()`
SQL function, ScaNN index via `alloydb_scann` extension.

**Rationale:** Replaces self-hosted vector store — no StatefulSets,
no PVC management, no HNSW tuning. Embedding happens inline via SQL
function (no separate embedding service). ScaNN outperforms HNSW at
scale. IAM via Workload Identity — no API keys.

**Alternatives considered:**
- Self-hosted Qdrant: operational overhead (StatefulSets, PVCs,
  HNSW tuning).
- Vertex AI Vector Search: separate service, no SQL integration.
- Cloud SQL pgvector: weaker index performance, no ScaNN.

**Best practices:**
- Embedding dimension: 768 (`text-embedding-005`).
- ScaNN index: `num_leaves = 64` for initial corpus size. Increase
  when corpus exceeds 1M chunks.
- Hybrid search: Reciprocal Rank Fusion of ScaNN vector results
  and BM25 keyword results. RRF constant `k=60`.
- Schema isolation: one schema per team, MCP server IAM scoped to
  own schema + `org_shared`.
- Hard-delete stale chunks on nightly re-index (no soft-delete).
- PII classifier at ingest: email regex + card number patterns →
  `sensitivity=restricted`, excluded from general search.

## R5: Langfuse Observability (Phase 1)

**Decision:** Self-hosted Langfuse on GKE with Cloud SQL backend
and BigQuery export.

**Rationale:** Self-hosted gives full control over data residency
(europe-west4). Native BigQuery export enables gap detection
analytics without custom ETL. OIDC SSO via Google Workspace.

**Alternatives considered:**
- Langfuse Cloud: data leaves our GCP project.
- Fully custom observability: months of engineering, no benefit.

**Best practices:**
- Deploy via official Helm chart.
- Cloud SQL Auth Proxy as sidecar (no credentials stored).
- Low-confidence threshold: start at 0.72, tune after 2 weeks of
  production data.
- Tag low-confidence traces with `gap_candidate` for gap detection.
- `tracedSearch()` wrapper around every MCP retrieval call.

## R6: PromptFoo CI Evals (Phase 1)

**Decision:** PromptFoo with `llm-rubric` assertions and
`not-contains` guards, run as GitHub Actions CI gate.

**Rationale:** PromptFoo supports LLM-graded evaluation (can check
if a response correctly applies a convention) and deterministic
assertions (can check for forbidden values). CI integration is
first-class.

**Alternatives considered:**
- Custom eval scripts: no standardized assertion framework, harder
  to maintain.
- Braintrust: heavier, more suited to production model evaluation
  than context quality testing.

**Best practices:**
- 5-10 test cases per team, owned by the team.
- Use `llm-rubric` for semantic assertions ("response states
  integers/minor units").
- Use `not-contains` for forbidden values (e.g., "9.99" when
  testing monetary amount conventions).
- Pass threshold: 85% (`--assert-pass-rate 0.85`).
- Trigger on changes to: `adrs/**`, `teams/**`, `CLAUDE.md`,
  `.specify/**`.

## R7: MCP Server Degraded Mode

**Decision:** When MCP server is unreachable, fall back to local
`~/.acme/context` files with a one-time warning.

**Rationale:** The SessionStart hook already pulls the context repo
locally. Local files provide convention and ADR lookups. Only
semantic search is unavailable. Warning ensures developer awareness
without blocking work.

**Implementation approach:**
- MCP server wrapper catches connection errors.
- On first failure: display `[acme] MCP server unreachable —
  using local context (search quality degraded)`.
- Subsequent calls in the same session: silently use local files.
- Local file reads use the same parsing logic as Phase 0 MCP
  server (text search over CLAUDE.md + ADR files).
