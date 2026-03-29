# Research: Agent Runtime Memory

## R1: Memory Storage — PostgreSQL + pgvector

**Decision:** Use the existing Lore PostgreSQL database with a new
`memory` schema. Same pgvector extension for embedding storage, same
CNPG operator for reliability and backups.

**Rationale:** Memory data is structurally similar to context chunks
— text content + vector embedding + metadata. The existing CNPG
cluster already runs pgvector with HNSW indexing. Adding a `memory`
schema keeps everything in one database without new infrastructure,
new connection strings, or new backup procedures. The operational
cost is near zero.

**Alternatives considered:**
- Separate Redis instance: fast key-value access but no vector
  search capability, no built-in versioning, and another service to
  operate and back up.
- SQLite per agent: simple and portable but no shared memory pools,
  no cross-agent search, and no centralized backup. Each agent's
  database is an island.
- Octopodas managed service: purpose-built for agent memory but
  introduces an external dependency that is not self-hosted. Contrary
  to the project goal of running everything on our own GKE cluster.

## R2: Embedding Strategy — Vertex AI text-embedding-005

**Decision:** Reuse the existing Vertex AI `text-embedding-005`
integration for embedding memory values and facts.

**Rationale:** The embedding pipeline is already wired — Workload
Identity for authentication, 768-dimensional vectors, HNSW index
parameters tuned. One embedding model for the whole system (context
chunks and agent memories) means one set of index parameters, one
distance function, and consistent similarity scores across search
results.

**Alternatives considered:**
- Local model (bge-small-en-v1.5): eliminates API dependency and
  runs on-cluster, but produces lower-quality embeddings for
  technical content. Would require a separate model serving
  deployment (Triton or vLLM).
- Voyage AI (voyage-code-3): stronger on code-heavy content, but
  requires a separate API key and billing account. Different
  embedding dimensions would need a second vector column or index.

## R3: Fact Extraction — Configurable LLM, Async

**Decision:** Use an LLM to break memory text into individual fact
statements. Extraction runs asynchronously after the memory write
succeeds. The LLM provider is configurable (Claude, OpenAI, Ollama).

**Rationale:** Extraction quality depends heavily on the LLM.
Making the provider configurable avoids vendor lock-in and lets teams
choose based on cost, latency, or availability (e.g., Ollama for
air-gapped environments). Running async means the write response is
never blocked by extraction — the memory is immediately searchable
as raw text while facts are extracted in the background.

**Alternatives considered:**
- Rule-based extraction (regex, spaCy NLP): low quality on
  unstructured technical text. Misses implicit facts and context.
- Synchronous extraction: blocks the write until the LLM responds.
  Adds 1-5 seconds of latency to every write with
  `extract_facts=true`. Unacceptable for high-throughput agents.
- No extraction (search raw text only): agents search over full
  paragraphs instead of individual facts. Lower precision — a
  paragraph about three topics matches queries for all three with
  similar scores, making ranking unreliable.

**Best practices:**
- Use structured output (JSON array of fact strings) to avoid
  parsing ambiguity.
- Limit to 10 facts per memory to keep the fact table manageable.
- Include the parent memory ID in each fact row so the original
  source text is always one join away.
- On LLM failure, queue for retry with exponential backoff
  (max 3 attempts). The memory remains searchable as raw text
  in the meantime.

## R4: Web UI — Next.js on GKE

**Decision:** Build the Lore web UI as a Next.js application
deployed in its own namespace on GKE. The app reads directly from
PostgreSQL — no separate API server.

**Rationale:** Next.js handles both server-side rendering (fast
initial page loads, SEO for internal tools) and client-side
interactivity in a single deployment. Next.js API routes query
PostgreSQL directly, eliminating a separate backend service. The
React ecosystem provides the richest selection of UI components
for dashboards, tables, search interfaces, and forms.

**Alternatives considered:**
- Plain React + Express: requires building and deploying two
  services (frontend + API). More boilerplate for the same result.
- Remix: capable framework but smaller ecosystem and fewer
  production references for internal tools.
- Grafana dashboards: limited interactivity. Cannot support custom
  features like task creation, spec editing, memory inspection with
  version history, or gap detection draft review.

**Best practices:**
- Use shadcn/ui for components — copy-pasted into the project, no
  heavy runtime dependencies, fully customizable.
- Server components for data fetching (agent lists, memory tables,
  audit trail).
- Client components for interactivity (search with live results,
  filters, memory version comparison).
- Auth via Google Workspace OIDC using NextAuth. Only
  `@re-cinq.com` emails have access.

## R5: Snapshot Implementation — Reference-Based

**Decision:** Snapshots store a JSONB column containing memory IDs
and their version numbers at the time of the snapshot. Restore sets
the version pointers back to the snapshotted values.

**Rationale:** At scale (up to 100,000 memories per agent), full
copies would double storage per snapshot. Reference-based snapshots
are O(n) in memory count for creation (scan all memory IDs and
current versions) but O(1) in storage growth — no data is
duplicated. Since memory versions are already preserved by the
versioning system (R1/FR-3), the snapshot only needs to record
which version was current at that point in time.

**Alternatives considered:**
- Full copy: simple to implement (INSERT INTO ... SELECT) but
  doubles storage per snapshot. At 100K memories with average 2 KB
  each, that is 200 MB per snapshot. Ten snapshots = 2 GB of
  duplicated data per agent.
- Incremental snapshots: store only changes since the last
  snapshot. Smaller storage than full copy, but restore requires
  replaying the full chain. Complex and fragile — a corrupted
  intermediate snapshot breaks all subsequent restores.
- WAL-based (PostgreSQL point-in-time recovery): native and
  reliable but operates at the database level, not agent-scoped.
  Cannot restore one agent's memories without restoring the entire
  database.

## R6: Agent Identity — UUID in ~/.lore/agent-id

**Decision:** Generate a random UUID on first use and store it in
`~/.lore/agent-id`. Klaus agents use their pod name, which is
already unique per instance.

**Rationale:** A file-based UUID is stable across sessions, requires
no external dependencies, and works offline. The file survives shell
restarts, editor changes, and MCP reconnections. It is simple to
inspect (`cat ~/.lore/agent-id`) and simple to reset (delete the
file). Klaus pod names are assigned by Kubernetes and are unique
within the cluster.

**Alternatives considered:**
- GitHub username (via `gh` CLI): requires `gh` to be installed and
  authenticated. Fails in CI environments and containers without
  GitHub credentials. Not unique across machines for the same user.
- `team@hostname`: not unique across OS reinstalls or container
  rebuilds. Two developers on identically named machines would
  collide.
- OAuth token hash: requires active auth state. Changes when the
  token is refreshed. Breaks the stability requirement.

## R7: Concurrent Write Resolution — Last-Write-Wins

**Decision:** Concurrent writes to the same memory key both succeed.
Each write creates a new version. The version with the latest
timestamp is returned by default read. All versions are preserved.

**Rationale:** Agent memory is not a collaborative editing system.
Two agents rarely write to the same key, and when they do, losing a
write is strictly worse than having two versions with a
deterministic winner. Last-write-wins is simple, predictable, and
lossless — every version is preserved in the version history and
can be retrieved explicitly.

**Alternatives considered:**
- Optimistic locking (version check on write): adds retry logic to
  every write path. Agents would need to handle "version conflict"
  errors and re-read before retrying. Complexity is not justified
  for the low-contention memory workload.
- Append-only (no key-based dedup): every write creates a new row,
  even for the same logical key. Simplifies writes but makes
  reads expensive — "latest value for key X" requires scanning
  all entries. Breaks the key-value mental model.
- Conflict-free replicated data types (CRDTs): designed for
  multi-writer distributed systems. Significant implementation
  complexity (merge functions, state vectors) for a problem that
  does not require it. Single-database architecture makes CRDTs
  unnecessary.
