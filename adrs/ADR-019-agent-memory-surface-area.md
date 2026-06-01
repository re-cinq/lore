---
adr_number: 19
title: "Agent memory surface area — deferred MCP tools and lifecycle-over-snapshot pivot"
status: accepted
date: 2026-04-20
domains: [memory, agents, mcp]
---

# ADR-019: Agent memory surface area

## Context

The `2-agent-memory` feature spec planned eight MCP tools that covered
four capabilities: memory CRUD, shared pools, snapshots, and health
monitoring. When the implementation shipped, several planned tools were
not registered in the MCP server.

Two capabilities were fully deferred at the MCP surface:

- **Shared pools** (`shared_write` / `shared_read`) — the internal
  `sharedWrite` and `sharedRead` functions exist in `memory.ts`, and
  the `memory.shared_pools` table is present in the schema. The MCP
  tools were never registered.
- **Snapshots** (`create_snapshot` / `restore_snapshot`) — the internal
  functions and `memory.snapshots` table exist. The MCP tools were
  never registered.
- **Agent health** (`agent_health`) — merged into `agent_stats`; not
  a separate tool.

A developer inspecting the schema sees `memory.shared_pools` and
`memory.snapshots` tables with no obvious entry point. The spec
(US5/US6) mentions these capabilities. This ADR records why the tools
were not exposed and what the sanctioned alternatives are.

## Decision

### 1. Shared pools: pool parameter instead of dedicated tools

Explicit `shared_write` / `shared_read` tools were dropped because
they duplicated the existing `write_memory` / `search_memory` interface
with only pool scoping added. The `pool` parameter on `write_memory`
writes a memory into a named pool without a separate tool call.
`search_memory(pool="pool-name")` scopes retrieval to the same pool.

Cross-agent sharing is opt-in and discoverable through the existing
tools. Adding dedicated pool tools would fragment the API surface and
require agents to learn two write interfaces for the same underlying
data.

**Workaround (current):**
- Write a pooled memory: `write_memory(key, value, pool="my-pool")`
- Search a pool: `search_memory(query, pool="my-pool")`
- Cross-machine sharing requires PostgreSQL (file fallback uses
  `~/.lore/memory/shared/<pool>/` and is local-only).

**Path to full pool CRUD if needed:** register `list_pools`,
`create_pool`, `delete_pool` tools in `mcp-server/src/index.ts`
backed by the existing `sharedWrite` / `sharedRead` functions in
`memory.ts`. No schema changes required.

### 2. Snapshots: lifecycle management supersedes crash recovery

The snapshot design (reference-based, per `specs/2-agent-memory/research.md#R5`)
assumed crash recovery was the primary durability concern — an agent
crashes and needs to be restored to its last known state. After the
importance decay and automatic consolidation strategy shipped (ADR-014),
the crash recovery use case dissolved:

- Every `write_memory` call commits to PostgreSQL with WAL-backed
  durability. There is no data loss on agent crash or pod preemption.
- Importance decay evicts low-value memories on a schedule, so the
  total memory footprint is bounded and well-defined without snapshots.
- Automatic fact consolidation (5:30 AM daily) compresses the full
  fact history into higher-level patterns, providing a summary
  representation that a snapshot would have served.

Creating a snapshot before an operation and restoring after failure
would add write amplification without providing durability that
PostgreSQL WAL does not already give. The tables remain in the schema
for potential future use (e.g., point-in-time agent context export),
but the crash-recovery framing is no longer valid.

**Path to snapshot tools if needed:** register `create_snapshot` and
`restore_snapshot` in `mcp-server/src/index.ts` backed by the existing
internal functions. The `memory.snapshots` table requires no migration.
Consider use cases: context export, pre-experiment checkpoints, or
cross-cluster migration — not crash recovery.

### 3. agent_health merged into agent_stats

`agent_stats` returns health indicators (last_active, oldest_memory,
snapshot_count, pool_count) alongside usage metrics. A separate
`agent_health` tool was redundant. Snapshot and pool counts are always
0 in the current implementation (those tools are not exposed), which
is intentional — the zeros signal that those surfaces are inactive.

## Consequences

- **Schema tables without MCP tools**: `memory.shared_pools` and
  `memory.snapshots` exist and will remain. Internal functions back
  them. They are not dead schema — they are reserved for future MCP
  tool registration with no migration cost.
- **Pool sharing works today** via the `pool` parameter on existing
  tools. Explicit pool management (list, create, delete) requires
  additional tool registration.
- **Snapshot restore is not available** to agents. The durability
  guarantee is PostgreSQL WAL + importance decay. If an agent needs
  a checkpoint before a destructive operation, write an episode via
  `write_episode` describing the pre-operation state — fact extraction
  captures the key information and it survives the lifecycle eviction
  cycle longer than raw memories.
- **Spec US5 and US6 remain deferred.** The spec is reconciled in
  `specs/2-agent-memory/tasks.md` (2026-04-20 note). Any future
  implementation should update the tasks to `Shipped` and register
  the tools.
