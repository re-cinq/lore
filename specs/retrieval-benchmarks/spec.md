# Feature Specification: Retrieval Benchmarks

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Retrieval Benchmarks                        |
| Status         | Draft                                       |
| Created        | 2026-04-03                                  |
| Owner          | Platform Engineering                        |
| Priority       | P2 — Observability                          |
| Motivation     | [Zep competitive research](../zep-competitive-research.md) |

## Problem Statement

Zep targets <200ms retrieval latency as a product SLA. We don't
know what Lore's actual retrieval latency is. Without measurements,
we can't:

1. Know if performance is degrading as data grows.
2. Set realistic SLAs for users.
3. Identify which retrieval path is the bottleneck (vector search,
   keyword search, RRF merge, graph queries, context assembly).
4. Make informed decisions about adding graph augmentation or
   other features that increase latency.

## Vision

Automated p50/p95/p99 latency tracking for all retrieval MCP
tools, visible in the analytics dashboard. Alerts when latency
exceeds thresholds. Baseline measurements established for current
data volumes.

## Functional Requirements

### FR-1: Server-Side Latency Tracking

- FR-1.1: Instrument `search_memory`, `query_graph`,
  `assemble_context`, `get_context`, and `get_adrs` with
  timing.
- FR-1.2: Record latency per call in `memory.audit_log` metadata
  (field: `latency_ms`).
- FR-1.3: Break down `search_memory` latency into sub-timings:
  embedding generation, vector search, keyword search, RRF merge.
- FR-1.4: Break down `assemble_context` into: per-source fetch
  time, token budgeting, total.

### FR-2: Analytics Dashboard Widget

- FR-2.1: Add a "Retrieval Performance" section to `/analytics`.
- FR-2.2: Show p50, p95, p99 latency per tool for the last 7
  days.
- FR-2.3: Show latency trend chart (daily p95).
- FR-2.4: Highlight tools exceeding 200ms p95 threshold.

### FR-3: Baseline Measurement

- FR-3.1: Create a benchmark script that runs 100 representative
  queries against the production database.
- FR-3.2: Queries drawn from real audit log searches (most common
  patterns).
- FR-3.3: Output: p50/p95/p99 for each tool, total query count,
  data volume (memories, facts, episodes, entities, edges).
- FR-3.4: Run as a scheduled job (weekly) to track trends.

### FR-4: Alert Thresholds

- FR-4.1: Configurable latency thresholds per tool (default:
  200ms p95 for search, 500ms for assemble_context).
- FR-4.2: When threshold is exceeded for 3 consecutive benchmark
  runs, log a warning.
- FR-4.3: Future: integrate with alerting system.

## Non-Functional Requirements

### NFR-1: Overhead

- Latency tracking adds < 1ms per call (timestamp diff only).
- No additional DB queries for instrumentation.

## Scope Boundaries

### In Scope

- Server-side latency instrumentation.
- Audit log metadata for latency.
- Analytics dashboard widget.
- Benchmark script.

### Out of Scope

- Client-side (Claude Code) latency tracking.
- Distributed tracing (already have OTEL, this is complementary).
- Automatic performance tuning.

## Success Criteria

1. Every retrieval MCP call has a `latency_ms` field in the
   audit log.
2. Analytics dashboard shows p50/p95/p99 for the last 7 days.
3. Baseline p95 measurements are established for current data
   volume.
4. Team knows whether Lore is under or over the 200ms target.
