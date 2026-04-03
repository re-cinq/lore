# Feature Specification: Agent Runtime Memory

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Agent Runtime Memory                        |
| Branch         | 2-agent-memory                              |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Owner          | Platform Engineering                        |

## Problem Statement

Lore gives agents access to organizational knowledge — conventions,
ADRs, PR history. But agents have no memory of their own. A Klaus
agent that runs gap detection on Monday has no idea what it tried
last Monday. A developer's Claude Code session forgets everything
when it closes. Every agent starts cold, every time.

Octopodas solves this as a managed cloud service. We want the same
capabilities self-hosted, integrated into Lore's existing PostgreSQL
+ pgvector infrastructure, accessible via MCP tools.

## Vision

Every agent — local Claude Code, Klaus cluster agent, or future
integrations — has persistent memory that survives sessions, restarts,
and crashes. Memories are versioned, timestamped, semantically
searchable, and can be shared across agents. The system extracts
individual facts from unstructured text so agents find exactly what
they need. When an agent crashes, its full state is recoverable from
the last snapshot in under a second.

## User Personas

### Developer (Claude Code user)

Works in Claude Code daily. Wants Claude to remember preferences,
past decisions, and context from previous sessions without repeating
themselves. Expects it to work automatically — no manual save/load.

### Klaus Agent (cluster worker)

Runs background tasks (ingestion, gap detection, spec drift). Needs
to remember what it did in previous runs: what gaps it already
drafted, what specs it already checked, what candidates it tried
and their scores. Without memory, it repeats work or misses patterns
that span multiple runs.

### Platform Engineer (operator)

Manages the Lore infrastructure. Needs to see what agents remember,
debug unexpected agent behavior by inspecting memories, manage
shared memory pools, and recover from agent crashes.

## User Scenarios & Acceptance Criteria

### Scenario 1: Agent Writes and Recalls a Memory

**Actor:** Any agent (Claude Code or Klaus)

**Flow:**
1. Agent writes a memory with a key and value.
2. In a later session, agent searches for related information.
3. System returns the relevant memory by semantic similarity.

**Acceptance Criteria:**
- Memory persists after the session ends.
- Semantic search returns the memory when queried with related
  (not identical) terms.
- Memory includes version number, timestamp, and agent ID.

### Scenario 2: Memory Versioning

**Actor:** Any agent

**Flow:**
1. Agent writes a memory with key "user-preference".
2. Agent updates the same key with new information.
3. Agent queries the history of that key.

**Acceptance Criteria:**
- Both versions are preserved.
- Latest version is returned by default.
- Full version history is available on request.
- Each version has a timestamp.

### Scenario 3: Fact Extraction

**Actor:** Any agent

**Flow:**
1. Agent stores a paragraph of unstructured text.
2. System extracts individual facts from the text.
3. Agent later searches for a specific fact within that text.

**Acceptance Criteria:**
- A single paragraph produces multiple searchable facts.
- Each fact is independently searchable via semantic search.
- Original source text is preserved alongside extracted facts.
- Extraction happens automatically on write (opt-in per memory).

### Scenario 4: Shared Memory Between Agents

**Actor:** Multiple agents (e.g., Klaus gap detection + Klaus
spec drift)

**Flow:**
1. Gap detection agent writes a finding to a shared pool.
2. Spec drift agent reads from the same pool.
3. Both agents see each other's contributions.

**Acceptance Criteria:**
- Named memory pools can be created and accessed by any agent.
- Write and read operations are tracked with agent ID and timestamp.
- An agent can list all shared pools it has access to.

### Scenario 5: Crash Recovery

**Actor:** Klaus agent (or any agent)

**Flow:**
1. Agent is running a long task, periodically snapshotting state.
2. Agent crashes (OOM, timeout, node preemption).
3. Agent is restarted and restores from the latest snapshot.

**Acceptance Criteria:**
- Snapshots capture all agent memories at a point in time.
- Restore recovers all memories from the snapshot.
- Recovery completes in under 1 second.
- Zero data loss between the last snapshot and the crash.

### Scenario 6: Memory TTL and Expiration

**Actor:** Any agent

**Flow:**
1. Agent stores a temporary memory with a TTL (e.g., 24 hours).
2. After the TTL expires, the memory is no longer returned in search.

**Acceptance Criteria:**
- Memories with TTL are automatically excluded from search after
  expiration.
- Expired memories are cleaned up periodically.
- Permanent memories (no TTL) are never auto-deleted.

### Scenario 7: Monitoring and Inspection

**Actor:** Platform Engineer

**Flow:**
1. Engineer opens a dashboard or queries the system.
2. Sees all agents, their memory counts, recent activity.
3. Drills into a specific agent's memories.
4. Searches across all agent memories for debugging.

**Acceptance Criteria:**
- All agents and their memory counts are visible.
- Individual memories can be inspected (key, value, versions,
  timestamps).
- Cross-agent search works (find a memory regardless of which
  agent wrote it).
- Audit trail shows writes, reads, searches, and snapshots with
  timestamps.

### Scenario 8: Memory Search Quality

**Actor:** Any agent

**Flow:**
1. Agent has accumulated 1000+ memories over weeks.
2. Agent searches with a natural language query.
3. System returns the most relevant memories ranked by similarity.

**Acceptance Criteria:**
- Search returns results in under 100 milliseconds.
- Top result is relevant to the query at least 85% of the time.
- Search works across all of an agent's memories simultaneously.
- Results include similarity score for transparency.

## Functional Requirements

### FR-1: Memory CRUD Operations

The system MUST provide MCP tools for creating, reading, updating,
and deleting agent memories.

- FR-1.1: `write_memory(key, value, agent_id?, ttl?, extract_facts?)`
  creates or updates a memory. Returns the memory with version number.
- FR-1.2: `read_memory(key, agent_id?)` returns the latest version
  of a specific memory.
- FR-1.3: `delete_memory(key, agent_id?)` soft-deletes a memory
  (preserved in history but excluded from search).
- FR-1.4: `list_memories(agent_id?, limit?, offset?)` returns all
  memories for an agent, paginated.
- FR-1.5: Agent ID is a random UUID generated on first use and
  stored in `~/.lore/agent-id`. Stable per machine across sessions.
  Klaus agents use their pod name. Can be overridden via explicit
  `agent_id` parameter on any tool call.

### FR-2: Semantic Search

The system MUST provide semantic search over agent memories.

- FR-2.1: `search_memory(query, agent_id?, limit?)` returns memories
  ranked by semantic similarity.
- FR-2.2: Search uses vector embeddings for meaning-based matching.
- FR-2.3: Results include similarity score (0-1).
- FR-2.4: Search scoped to a single agent by default, cross-agent
  search available via parameter.

### FR-3: Memory Versioning

The system MUST version every memory update.

- FR-3.1: Every write to an existing key creates a new version.
- FR-3.2: Previous versions are preserved and queryable.
- FR-3.3: `read_memory` returns latest version by default.
- FR-3.4: Version history available via
  `read_memory(key, version="all")`.
- FR-3.5: Each version has a monotonic version number and timestamp.
- FR-3.6: Concurrent writes to the same key use last-write-wins.
  Both writes succeed and create versions. The version with the
  latest timestamp is returned by default read. No data is lost.

### FR-4: Fact Extraction

The system MUST extract individual facts from unstructured text.

- FR-4.1: When `extract_facts=true`, the system breaks the value
  into individual fact statements.
- FR-4.2: Each fact is stored as a separate searchable unit linked
  to the parent memory.
- FR-4.3: Extraction uses an LLM (configurable: Claude, OpenAI,
  or local Ollama).
- FR-4.4: Original text is preserved alongside extracted facts.
- FR-4.5: Facts are embedded independently for fine-grained search.
- FR-4.6: If the extraction LLM is unreachable, the memory write
  succeeds immediately. Fact extraction is queued for later retry.
  The memory is searchable as raw text until extraction completes.

### FR-5: Shared Memory Pools

The system MUST support named memory spaces shared across agents.

- FR-5.1: `shared_write(pool, key, value, agent_id?)` writes to
  a named pool.
- FR-5.2: `shared_read(pool, key?)` reads from a pool (all entries
  or specific key).
- FR-5.3: `search_memory(query, pool?)` searches within a specific
  pool.
- FR-5.4: Pools are created implicitly on first write.
- FR-5.5: All shared operations are attributed to the writing agent.

### FR-6: Crash Recovery

The system MUST provide snapshot and restore capabilities.

- FR-6.1: `create_snapshot(agent_id?)` captures all current memories
  for an agent.
- FR-6.2: `restore_snapshot(snapshot_id)` restores all memories
  from a snapshot.
- FR-6.3: Automatic snapshots before long-running operations
  (configurable interval).
- FR-6.4: Snapshot metadata includes: agent ID, timestamp, memory
  count, trigger (manual/auto).
- FR-6.5: Recovery time under 1 second for up to 10,000 memories.
- FR-6.6: Snapshots are reference-based: they store memory IDs and
  version numbers, not full copies of memory values. Restore sets
  version pointers. No data duplication.

### FR-7: TTL and Expiration

The system MUST support time-to-live for memories.

- FR-7.1: Optional TTL on any memory (seconds or ISO duration).
- FR-7.2: Expired memories excluded from search results.
- FR-7.3: Background cleanup job removes expired memories
  periodically.
- FR-7.4: Permanent memories (no TTL) never auto-deleted.

### FR-8: Monitoring and Audit

The system MUST provide visibility into agent memory operations.

- FR-8.1: All operations (write, read, search, delete, snapshot,
  restore) logged with timestamp and agent ID.
- FR-8.2: Agent health endpoint returns memory count, last active
  time, snapshot count.
- FR-8.3: MCP tools for querying audit trail:
  `agent_health(agent_id?)`, `agent_stats(agent_id?)`.
- FR-8.4: Web UI for browsing memories, agent activity, search
  quality, and audit trail.
- FR-8.5: The UI also serves as the non-developer interface to Lore.
  Product owners and managers can use it to: add tasks and specs,
  view agent work in progress, browse organizational context, and
  review gap detection drafts — without using Claude Code.
- FR-8.6: UI reads from the same PostgreSQL database as the MCP
  server. No separate data store.

## Non-Functional Requirements

### NFR-1: Performance

- Write latency under 50 milliseconds for single memory operations.
- Search latency under 100 milliseconds for 10,000+ memories.
- Snapshot creation under 5 seconds for 10,000 memories.
- Restore under 1 second for 10,000 memories.

### NFR-2: Scalability

- Support up to 100 concurrent agents.
- Up to 100,000 memories per agent.
- Up to 1,000,000 total memories across all agents.

### NFR-3: Reliability

- Zero data loss on agent crash (snapshot + WAL).
- Memories survive pod restarts and node preemption.
- Shared pool operations are atomic (no partial reads).

### NFR-4: Security

- Agent memories are isolated by default (agent A cannot read
  agent B's private memories).
- Shared pools have explicit opt-in.
- No credentials, API keys, or PII stored in memory values
  (enforced by content filter on write).
- Audit trail is immutable.

## Clarifications

### Session 2026-03-29

- Q: What happens on concurrent writes to the same memory key? → A: Last-write-wins. Both writes succeed, both create versions, latest timestamp wins for default read. No data lost.
- Q: What happens when fact extraction LLM is unreachable? → A: Write succeeds immediately, facts queued for async retry. Memory searchable as raw text until extraction completes.
- Q: How is agent identity established for Claude Code sessions? → A: Random UUID generated on first use, stored in ~/.lore/agent-id. Stable per machine. Klaus agents use pod name. Overridable via explicit agent_id parameter.
- Q: How are snapshots stored at scale? → A: Reference-based. Snapshot stores memory IDs + version numbers, not full copies. Restore sets version pointers. No data duplication.
- Q: Should memory operations emit OTEL spans? → A: No. Build a web UI instead that exposes agent memory, audit trail, and system status. The UI also serves as the non-developer interface — product owners/managers can add tasks, specs, and context to Lore without using Claude Code.

## Scope Boundaries

### In Scope

- MCP tools for memory CRUD, search, snapshots, shared pools.
- Memory schema in existing PostgreSQL + pgvector database.
- Fact extraction via LLM.
- Version history for all memories.
- TTL and expiration.
- Audit trail.
- Agent health and stats MCP tools.

### Out of Scope

- Real-time notifications when shared pool updates.
- Memory encryption at rest (relies on database-level encryption).
- Multi-cluster memory sync (single cluster for now).
- Memory import/export.

## Dependencies

- Existing PostgreSQL + pgvector instance (CNPG on GKE).
- Existing Lore MCP server (extends with new tools).
- Vertex AI or configurable LLM for fact extraction.
- Vertex AI text-embedding-005 for memory embeddings.

## Assumptions

- The existing MCP server can be extended with additional tools
  without a separate service.
- PostgreSQL + pgvector handles the memory workload alongside the
  existing context chunks.
- Agent IDs are stable across sessions (derived from MCP session
  or explicitly provided).
- Fact extraction is acceptable as an async operation (doesn't
  block the write response).

## Success Criteria

1. An agent writes a memory in one session and retrieves it by
   semantic search in a later session, without any manual loading.
2. A Klaus agent remembers what gap detection candidates it tried
   last week and avoids repeating them.
3. Two agents share findings through a named memory pool without
   custom integration code.
4. An agent crashes and is fully restored from a snapshot in under
   1 second with zero data loss.
5. A platform engineer can inspect any agent's memories and search
   across all agents from MCP tools.
6. The system handles 100 concurrent agents with 10,000 memories
   each without degraded search performance (under 100ms).
7. Fact extraction improves search precision by at least 30%
   compared to storing raw paragraphs.
