# Feature Specification: Graph-Enriched Context Assembly

| Field          | Value                                                                                   |
|----------------|-----------------------------------------------------------------------------------------|
| Feature        | Graph-Enriched Context Assembly                                                          |
| Status         | **Draft**                                                                                |
| Created        | 2026-06-10                                                                               |
| Owner          | Platform Engineering                                                                     |
| Consumes       | [`spec-traceability-graph`](../spec-traceability-graph/spec.md) — `Statement` + `validated_by`/`decided_by` edges |
| Sibling        | [`project-test-interface`](../project-test-interface/spec.md) — the `violated`/coverage signal this ranks on |

## Problem Statement

`assemble_context` retrieves chunks by vector similarity and fuses them
with RRF. That answers *"what text looks like the query"* — it does not
answer *"what intent governs this code, and is that intent currently
honored."* Two failure modes follow:

- **Constraint loss.** The ADR that decided a boundary is scattered far
  from the code it governs, so an agent re-litigates a settled decision.
- **No signal ordering.** A spec statement whose contract is *broken*
  (`violated`) or whose link points at moved code (`drifted`) is the
  single highest-value thing to hand an agent about to touch coupled
  code — but it is not *similar* to the query, so similarity search
  never ranks it first.

The traceability graph already holds the missing structure: each
`Statement` carries its testability, its `violated`/`drifted` flags, the
tests that `validated_by` it, and the ADR that `decided_by` it. The
context assembler should project that structure into a ranked,
deduplicated, budget-capped block — **deterministically, zero-LLM**.

## Solution

A pure projection, `assembleGraphContext`, from a Dgraph query result of
the spec `Statement`s coupled to a task into a `GraphContextBlock`: the
statements ranked by signal, plus the distinct ADR refs and test
selectors to hydrate alongside them. The I/O wrapper that runs the DQL is
a thin seam over the injected `DgraphClientPort`, mirroring
[`fetchTraceDocument`](../../shared/src/spec-trace/assemble-trace-document.ts).
The projection and its wrapper live in
([`graph-context.ts`](../../shared/src/spec-trace/graph-context.ts)).

## Acceptance Criteria

A statement's signal is the highest-priority condition it meets, in the
order `violated` > `drifted` > `untested` > `normal`.
([validated by `ranks ... and dedups by xid`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L5))

Statements are ranked by signal descending, so a `violated` statement
precedes a `drifted` one and both precede an `untested` or `normal`
statement.
([validated by `ranks ... and dedups by xid`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L5))

A `Statement` reachable through more than one seed appears once in the
block, deduplicated by its `Statement.xid`.
([validated by `ranks ... and dedups by xid`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L5))

A testable statement carrying no `validated_by` test link has signal
`untested`; an `untestable` statement is `normal` regardless of its
links.
([validated by `classifies an untestable statement as normal`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L60))

The block exposes the distinct ADR file paths across all ranked
statements as `adrRefs`, in first-appearance order after ranking.
([validated by `collects per-statement links and distinct block-level adrRefs and testSelectors`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L76))

The block exposes the distinct test file paths across all ranked
statements as `testSelectors`.
([validated by `collects per-statement links and distinct block-level adrRefs and testSelectors`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L76))

When the ranked statements exceed the budget limit, the block keeps the
highest-signal `limit` statements and reports `truncated: true`.
([validated by `keeps the highest-signal limit statements and reports truncated`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L111))

An empty query result projects to an empty block with no statements, no
refs, and `truncated: false`.
([validated by `projects an empty result to an empty block`](../../shared/src/spec-trace/__tests__/graph-context.test.ts#L127))

## Out of Scope

- The vector seeding step that picks *which* statements to expand from
  (this feature ranks an already-resolved coupled set).
- Wiring the block into the live `assemble_context` template ordering.
- The code-seeded path — covered by
  [`trace-impact`](../../shared/src/spec-trace/trace-impact.ts).
