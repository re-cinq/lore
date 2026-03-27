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

## R4: PostgreSQL + pgvector via CloudNativePG (Phase 1)

**Decision:** PostgreSQL 16 with pgvector extension, deployed via
the CloudNativePG (CNPG) Kubernetes operator on GKE. HNSW index
for vector similarity search. Same `<=>` cosine distance operator
as AlloyDB. Embedding via application-level Vertex AI
`text-embedding-005` calls.

**Rationale:** CNPG provides a production-grade PostgreSQL on
Kubernetes without managed-service lock-in. pgvector's HNSW index
delivers sub-200ms p99 latency for our corpus size (~1M vectors).
The SQL interface is identical — same `<=>` operator, same hybrid
search pattern. Upgrade path to AlloyDB Omni (containerized) or
managed AlloyDB is straightforward if scale demands it.

**Alternatives considered:**
- AlloyDB AI (managed GCP): higher cost, ScaNN advantage only
  matters at >10M vectors. Remains the upgrade path.
- Self-hosted Qdrant: operational overhead (StatefulSets, PVCs,
  custom backup), no SQL interface.
- Vertex AI Vector Search: separate service, no SQL integration.
- Cloud SQL pgvector: managed but less control than CNPG, no
  operator-level backup/failover customization.

**Upgrade path:**
- AlloyDB Omni (containerized): drop-in replacement, same pgvector
  interface, adds ScaNN if needed at scale.
- Managed AlloyDB: when corpus exceeds ~10M vectors or when
  `embedding()` SQL function is preferred over app-level calls.

**Best practices:**
- Embedding dimension: 768 (`text-embedding-005`).
- HNSW index: `m = 16`, `ef_construction = 64` for initial corpus.
  Tune `ef_search` (default 40) based on recall/latency tradeoff.
- Hybrid search: Reciprocal Rank Fusion of HNSW vector results
  and BM25 keyword results. RRF constant `k=60`.
- Schema isolation: one schema per team, MCP server IAM scoped to
  own schema + `org_shared`.
- Hard-delete stale chunks on nightly re-index (no soft-delete).
- PII classifier at ingest: email regex + card number patterns →
  `sensitivity=restricted`, excluded from general search.
- CNPG operator handles backups (Barman to Cloud Storage),
  failover, and rolling updates.

## R5: OpenTelemetry → Cloud Monitoring (Phase 1)

**Decision:** OpenTelemetry SDK instrumentation in the MCP server,
exporting traces and custom metrics to Cloud Monitoring (free on
GCP). No separate observability service. Gap signal feeds into
Graphiti episodes in Phase 3.

**Rationale:** Cloud Monitoring is free for GKE workloads and
natively integrated. OTEL is the industry-standard instrumentation
layer — no vendor lock-in. Eliminates the operational overhead of
running a separate Langfuse instance (Cloud SQL, Helm chart, OIDC
config). Gap candidate metrics are queryable via Cloud Monitoring
API for the gap detection Klaus agent.

**Alternatives considered:**
- Langfuse self-hosted: additional Cloud SQL instance, Helm chart
  maintenance, OIDC configuration. Significant operational overhead
  for what is primarily latency + gap signal.
- Langfuse Cloud: data leaves our GCP project.
- Fully custom observability: months of engineering, no benefit.

**Fallback:**
- Langfuse Lite (sidecar mode): can be added later if deeper trace
  debugging is needed beyond what Cloud Monitoring provides. No
  architectural changes required — OTEL spans are compatible.

**Best practices:**
- Use `@opentelemetry/sdk-node` with
  `@opentelemetry/exporter-cloud-monitoring`.
- `tracedSearch()` wrapper emits OTEL spans around every MCP
  retrieval call.
- Low-confidence threshold: start at 0.72, tune after 2 weeks of
  production data.
- Tag low-confidence spans with `gap_candidate` attribute + emit
  `lore/gap_candidates` custom metric for gap detection.
- Cloud Monitoring dashboards: retrieval latency p99, gap candidate
  rate, query volume per namespace.

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
`~/.re-cinq/lore` files with a one-time warning.

**Rationale:** The SessionStart hook already pulls the context repo
locally. Local files provide convention and ADR lookups. Only
semantic search is unavailable. Warning ensures developer awareness
without blocking work.

**Implementation approach:**
- MCP server wrapper catches connection errors.
- On first failure: display `[lore] MCP server unreachable —
  using local context (search quality degraded)`.
- Subsequent calls in the same session: silently use local files.
- Local file reads use the same parsing logic as Phase 0 MCP
  server (text search over CLAUDE.md + ADR files).
