# Feature Specification: Graph-Augmented Search

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Graph-Augmented Search                      |
| Status         | Draft                                       |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P1 — Lower effort                           |
| Motivation     | [Zep competitive research](../zep-competitive-research.md), [Live knowledge graph FR-5](../live-knowledge-graph/spec.md) |
| Depends on     | [Live knowledge graph](../live-knowledge-graph/spec.md) (shipped) |

## Problem Statement

`search_memory` returns facts and memories ranked by text
similarity. It has no awareness of the knowledge graph. If an
agent searches for "database performance", it finds facts that
mention those words — but misses related context like which
services use the database, which team owns them, and which ADRs
govern the database layer.

The knowledge graph has this information (entities + edges), but
it's only accessible via the separate `query_graph` tool. Agents
would need to make two calls and merge the results themselves.

This was specced as FR-5 in the live-knowledge-graph spec but
not implemented.

## Vision

`search_memory` gains an optional `graph_augment` parameter.
When enabled, search results are enriched with 1-hop graph
neighbors of matched entities. If a fact mentions "auth-service",
the response also includes what auth-service uses, who owns it,
and what it depends on — without a separate tool call.

## Functional Requirements

### FR-1: Entity Detection in Search Results

- FR-1.1: After `search_memory` computes results via RRF, scan
  the top results for entity names that exist in `memory.entities`.
- FR-1.2: Use a simple substring match against known entity names
  (cached at startup, refreshed every 5 minutes).
- FR-1.3: Collect unique matched entity names.

### FR-2: Graph Neighbor Retrieval

- FR-2.1: For each matched entity, fetch 1-hop neighbors from
  `memory.edges` (active edges only, `valid_to IS NULL`).
- FR-2.2: Format as: `"entity (type) --relation--> neighbor (type)"`.
- FR-2.3: Limit to 10 graph results total to avoid noise.

### FR-3: Result Merging

- FR-3.1: Graph results are appended to the search results with
  `source: "graph"` and a lower RRF score than direct matches.
- FR-3.2: Graph results that duplicate information already in the
  direct results are deduplicated.

### FR-4: search_memory Parameter

- FR-4.1: Add `graph_augment: boolean` parameter to `search_memory`
  MCP tool (default: `false`).
- FR-4.2: When false, behavior is unchanged.
- FR-4.3: When true, graph augmentation runs after RRF merge.

## Non-Functional Requirements

### NFR-1: Performance

- Graph augmentation adds < 100ms to search latency.
- Entity name cache avoids per-query DB lookups.

## Scope Boundaries

### In Scope

- `graph_augment` parameter on `search_memory`.
- Entity name detection in results.
- 1-hop neighbor retrieval.
- Result merging with source tagging.

### Out of Scope

- Multi-hop traversal (> 1 hop) in search augmentation.
- Automatic `graph_augment: true` default (opt-in only).
- Graph augmentation in `assemble_context` (it already queries
  the graph as a separate section).

## Data Model Changes

None — uses existing `memory.entities` and `memory.edges` tables.

## Success Criteria

1. `search_memory("database performance", graph_augment=true)`
   returns direct fact matches PLUS graph context about which
   services use the database and who owns them.
2. Search latency stays under 300ms with augmentation enabled.
3. No change in behavior when `graph_augment` is false (default).
