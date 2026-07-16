---
adr_number: 21
title: "Context assembly: graph-derived, signal-ranked source"
status: in progress
date: 2026-06-10
domains: [shared, mcp-server, context, retrieval, spec-trace]
---

# ADR-021: Context assembly — graph-derived, signal-ranked source

Adds a graph-derived context source projected from the spec-traceability graph that ranks coupled spec statements by collision signal (violated over drifted over untested) rather than textual similarity, degrading gracefully when the graph is absent.

## Context

[ADR-020](ADR-020-context-assembly-xml-and-relevance.md) made `lore_assemble_context`
retrieval relevance-ranked (`ts_rank` BM25), deduped, and XML-tagged. But it ranks
by **textual similarity to the query** and draws **only from the Postgres chunk
store**; it explicitly deferred embeddings and does not touch the spec-traceability
graph.

Similarity can't surface the highest-value context for a code task. The spec
`Statement` that governs the code being changed, the ADR that `decided_by` it, and
the tests that `validated_by` it are the binding intent — and whether that intent
is currently **broken** (`violated`) or **stale** (`drifted`) is the single most
important thing to hand an agent about to touch coupled code. None of that is
*similar* to the query string, so `ts_rank` never ranks it first. The graph already
holds the structure; assembly wasn't using it.

## Decision

Add a **graph-derived context source**, projected from the spec-traceability graph
(Dgraph), feeding the same `<context>` block ADR-020 defined.

1. **Signal ranking, not similarity.** `assembleGraphContext`
   (`shared/src/spec-trace/graph-context.ts`) ranks coupled `Statement`s by
   collision signal — `violated` > `drifted` > `untested` > `normal` — dedups by
   `Statement.xid`, caps to a budget (`truncated` flag), and exposes the distinct
   ADR refs + test selectors to hydrate alongside.
2. **Pure projection + thin seam.** A pure function over a graph query result plus
   a `fetchGraphContext` wrapper over the injected `DgraphClientPort`; a null port
   degrades to an empty block, so the ADR-020 `ts_rank` path is unaffected when the
   graph is absent.
3. **Two seeding modes.** File-seeded (reuse `computeImpact` for pipeline tasks
   with a known diff) lands first; query-seeded vector/graph expansion is deferred.
   Zero-LLM and deterministic throughout.
4. **Gated on measurement.** Wiring this source into live template ordering is
   gated behind an A/B against similarity-only (rejection rate + review-comment
   count on spec-coupled tasks), not shipped on faith.

Requirements and test-linked acceptance criteria live in
`specs/graph-context-assembly/spec.md`.

## Consequences

- **Positive:** broken/stale contracts and ADR rationale that similarity buries now
  rank first; deterministic and free (no LLM); degrades gracefully to the ADR-020
  path when the graph is unavailable.
- **Bounded by coverage:** the source is only as good as `implemented_by` /
  `validated_by` edge density, which is sparse today (the `IMPLEMENTED_BY`
  projection is still maturing). Until those edges fill in, the source returns
  empty for most repos — additive, never harmful. The `Statement`/`ADR` nodes this
  source reads are populated by the spec/ADR projection, which is now CI-driven via
  the spec-trace trigger (per [ADR-023](ADR-023-test-run-trace-binding.md)), not a
  pipeline task.
- **Accepted:** assembly gains one Dgraph read (skippable via the null-port seam);
  the ADR-020 `ts_rank` chunk sources remain the breadth — this adds depth.

## Status

**Wired (fail-soft), pending the A/B gate.** `fetchCouplingSource` →
`fetchGraphContext` → `assembleGraphContext` is now a `coupling` source in the
`implementation` (P2) and `review` (P1) templates; `/api/context` builds the
Dgraph client via `createDgraphClient(process.env)` and threads it into
`assembleContext`. With `LORE_DGRAPH_HTTP` unset (today's cluster) the source
returns `disabled` / empty, so it is inert in production until the graph
projection is populated — which is also when the §4 A/B (rejection-rate /
review-comment count) should run before the section is given real budget weight.

## Alternatives considered

- **Fold into ADR-020.** Rejected — a new retrieval *source* with a new dependency
  (the traceability graph) and a different ranking principle (collision signal vs
  text similarity) warrants its own record. ADR-020 stands; this extends it.
- **Embeddings/cosine ranking** (ADR-020's deferred item). Orthogonal — that
  improves *similarity* ranking of chunks; this adds a *structural* signal the
  chunk store can't express. Either or both can ship.
- **LLM re-ranking of context.** Rejected — non-deterministic, costs tokens, and
  forfeits the zero-LLM/free property that lets this run on every assembly.
