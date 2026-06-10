# Feature Specification: `agent_stats` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `agent_stats` MCP tool                           |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `agent_stats`                                    |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

There is no single call that tells an operator how much an agent has learned
and how active it is — memory count, fact counts (active vs invalidated),
search activity, shared pools, and recent episodes. Without it, diagnosing a
quiet or runaway agent means hand-writing SQL across several `memory.*` tables.

## Solution

`agent_stats` aggregates per-agent counters in parallel: health
(`memory_count`, `last_active`, `snapshot_count`), stats (`total_memories`,
`total_facts`, `active_facts`, `invalidated_facts`, `total_searches`,
`shared_pools_created`), and the five most-recent episodes with a fact count
and content preview. All counters are scoped to the resolved agent id.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L291) (IMPLEMENTED_BY)
- Handler — stats: [`memory.ts` `agentStats`](../../../mcp-server/src/features/memory/memory.ts#L315) (IMPLEMENTED_BY)
- Handler — health: [`memory.ts` `agentHealth`](../../../mcp-server/src/features/memory/memory.ts#L304) (IMPLEMENTED_BY)

## Acceptance Criteria

1. Stats returns fact/memory/search counters keyed to the resolved agent. ([validated by `returns fact/memory/search counters keyed to the agent`](../../../mcp-server/src/features/memory/memory.test.ts#L238))
2. Health returns memory and snapshot counts keyed to the resolved agent. ([validated by `returns memory/snapshot counts keyed to the agent`](../../../mcp-server/src/features/memory/memory.test.ts#L217))

## Out of Scope

- The recent-episodes preview query (composed inline in the tool handler, not
  in a standalone unit) (untested: requires live `memory.episodes` rows).
- Cross-agent / org-wide aggregation.
