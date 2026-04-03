# Competitive Research: Zep Context Engineering Platform

**Date:** 2026-04-03
**Source:** Manual analysis of https://www.getzep.com/

## What Zep Is

Zep is a **context engineering platform** for AI agents — a managed service that ingests data from any source, builds a **temporal knowledge graph**, and assembles relevant context for agents in <200ms.

Their core insight: agents fail because of bad context, not bad models. So they solve the retrieval + assembly layer.

---

## Zep's Key Ideas (vs. Lore's current state)

### 1. Temporal fact invalidation

Zep tracks *when* facts are valid. When a new fact contradicts an old one ("user switched from Adidas to Nike"), it automatically invalidates the old fact and records a `valid_to` timestamp.

**Lore today**: Facts in `memory.facts` are inserted and never invalidated. Both the old and new fact coexist and pollute search results. The memory versioning tracks history at the memory level but doesn't propagate to facts.

### 2. Episodes as the ingestion primitive

Zep's unit of ingestion is an **episode** — any time-stamped blob of data (conversation turn, business event, document). Episodes flow through a pipeline: extract entities -> update graph -> update facts.

**Lore today**: Memory is explicit key-value writes by agents. There's no passive ingestion path. An agent has to call `write_memory` deliberately. If it doesn't, nothing is captured.

### 3. Live graph vs. static graph

Zep's knowledge graph is **live** — updated in real-time as episodes arrive.

**Lore today**: The graph (`graphrag/graph.json`) is a **static file built offline**, and the code explicitly states it requires "3+ months of accumulated content." This makes the graph irrelevant for new repos or fast-moving teams.

### 4. Context assembly as a first-class feature

Zep has **context blocks** — structured templates that define how retrieved facts, summaries, and relationships are formatted before being sent to the LLM. This is a separate, explicit step.

**Lore today**: Agents get raw text back from `search_memory` and assemble their own context. No structured assembly layer exists.

### 5. Per-user and group graphs

Zep organizes graphs around **Users** and **Groups** — each user gets an isolated subgraph, groups get shared ones.

**Lore today**: Memory is agent-scoped, with shared pools for cross-agent sharing. But there's no graph-level isolation — all graph data is flat per-repo.

---

## What Lore Has That Zep Doesn't

Zep is a generic agent memory platform. Lore's differentiation is **code-context awareness** — ADRs, PR history, team conventions, repo structure. Zep has no concept of a git repo, PR, or engineering team. The memory layer is just one piece; the ingestion pipeline (nightly indexing of repos, PRs, ADRs) is where Lore's actual moat sits. The Zep comparison is most useful for improving the memory/facts subsystem, not rethinking the product.

---

## Priority Features Derived

| Priority | Feature | Effort | Spec |
|----------|---------|--------|------|
| 1 | Temporal fact invalidation | Lower | `specs/temporal-fact-invalidation/` |
| 2 | Passive episode ingestion | Lower | `specs/episode-ingestion/` |
| 3 | Live knowledge graph | Higher | `specs/live-knowledge-graph/` |
| 4 | Context assembly templates | Higher | `specs/context-assembly/` |

## Follow-ups (not yet specced)

| # | Follow-up | Effort | Why |
|---|-----------|--------|-----|
| 5 | Auto-episode hooks | Lower | `write_episode` exists but requires explicit calls. Hooks on SessionStart/PostToolUse should auto-capture session summaries and PR reviews — makes ingestion truly passive. |
| 6 | Graph-augmented search | Lower | `search_memory` should gain `graph_augment: boolean` to enrich results with 1-hop graph neighbors. Specced in live-knowledge-graph FR-5 but not built. |
| 7 | Retrieval benchmarks | Lower | Measure p95 latency for `search_memory` and `assemble_context`. Zep targets <200ms — we don't know our actual numbers. |
