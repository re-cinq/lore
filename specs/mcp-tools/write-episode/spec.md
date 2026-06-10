# Feature Specification: `write_episode` MCP tool

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | `write_episode` MCP tool                         |
| Status  | **Draft**                                        |
| Created | 2026-06-10                                       |
| Owner   | Platform Engineering                             |
| Tool    | `write_episode`                                  |
| Module  | memory                                           |
| Scope   | shared                                           |

## Problem Statement

Curated `write_memory` calls capture only what an agent decides to write down.
Most useful knowledge — conversation turns, code reviews, observations —
arrives as raw, unstructured text that no one will hand-curate. We need passive
capture: ingest the raw blob once, de-duplicate it, and let the system extract
individually-searchable facts and knowledge-graph entities from it
asynchronously.

## Solution

`write_episode` stores raw text as a `memory.episodes` row (secrets stripped,
content-hashed, embedded), idempotent on `(agent_id, content_hash)`. On a new
insert it fires two best-effort async jobs: fact extraction
(`extractFactsFromEpisode` → `parseFacts` → contradiction-invalidating fact
writes) and graph extraction (`extractAndUpdateGraph` → `parseGraphExtraction`
→ entity/edge upserts). It writes a `write_episode` audit entry.

- Registration: [`memory-tools.ts`](../../../mcp-server/src/mcp/tools/memory-tools.ts#L193) (IMPLEMENTED_BY)
- Fact extraction: [`facts.ts` `extractFactsFromEpisode`](../../../mcp-server/src/features/memory/facts.ts#L213) (IMPLEMENTED_BY)
- Graph extraction: [`graph.ts` `extractAndUpdateGraph`](../../../mcp-server/src/features/memory/graph.ts#L119) (IMPLEMENTED_BY)

## Acceptance Criteria

1. Extracted facts parse from a JSON array of fact strings. ([validated by `parses a JSON array of strings`](../../../mcp-server/src/features/memory/facts.test.ts#L30))
2. Fact extraction caps at 10 facts per episode. ([validated by `limits to 10 facts`](../../../mcp-server/src/features/memory/facts.test.ts#L53))
3. A new fact that closely matches an existing one invalidates the old fact. ([validated by `invalidates high-similarity facts`](../../../mcp-server/src/features/memory/facts.test.ts#L123))
4. No invalidation happens when no similar fact exists. ([validated by `does nothing when no similar facts exist`](../../../mcp-server/src/features/memory/facts.test.ts#L144))

## Out of Scope

- The episode INSERT / dedupe / audit composed inline in the tool handler
  (untested: requires live `memory.episodes` + content-hash conflict).
- Embedding generation and secret redaction (owned by their own modules).
- The graph-side projection (covered by the `query_graph` spec).
