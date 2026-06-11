---
adr_number: 23
title: "Test-run ↔ statement binding via inline spec links"
status: proposed
date: 2026-06-11
domains: [shared, spec-trace, test-interface, observability]
---

# ADR-023: Test-run ↔ statement binding via inline spec links

## Context

The spec-traceability pipeline has two halves that never meet.

The **spec side** is the source of truth for *which* test validates a
statement: each statement in `spec.md` carries an inline
`([validated by `name`](path/to/test.ts#L42))` parenthetical
([`spec-test-coverage` v3](../specs/spec-test-coverage/spec.md)), and
[`projectSpecFile`](../shared/src/spec-trace/project-spec-file.ts) turns it into
a `Statement.validated_by` edge at ingest.

The **run side** is the source of truth for *whether that test passed*:
[`lore-tests.yml`](../.github/workflows/lore-tests.yml) POSTs ~2.4k test
descriptors + results to `/api/repos/:o/:r/test-report` on every push to `main`,
and [`ingestTestReport`](../shared/src/spec-trace/ingest-test-report.ts) projects
them — already setting `Statement.validated_by` **and** `Statement.violated`
when a descriptor carries a `spec` anchor (`path#ordinal`).

The gap: the producer
([`descriptorsFromVitestList`](../shared/src/spec-trace/trace-descriptors.ts))
emits no `spec` anchor, and the only other binding —
`groupStatementsBySentence` resolving a describe-chain against statement prose —
rarely fires for conventional `describe("fnName", …)` tests. So the run side
computes pass/fail for every test but cannot attach it to a statement. The
`violated` signal — the highest-rank input to the coupling context source
(`violated > drifted > untested > normal`, [ADR-021](ADR-021-graph-derived-context-source.md))
— is structurally near-impossible to produce.

A second, independent problem: the agent's `/api/trigger/spec-trace` handler
runs `ingestSpecTrace(...).catch(console.error)` and **discards** the rich
`{validatedBy, violated, coverageNodes, coversEdges}` result; the HTTP endpoint
returns its own naive `countReport` guess. Nobody can tell whether a 2.4k-test
ingest created 12 edges or 1200.

## Decision

1. **Derive descriptor `spec` anchors from the inline spec links.** A pure
   inverter, `bindDescriptorsToSpecLinks(descriptors, specs)`
   (`shared/src/spec-trace/`), reuses
   [`linksForStatements`](../shared/src/spec-link-parser.ts) to index every
   statement's inline test links by `(path, line)`, then stamps
   `descriptor.spec = `${specPath}#${ordinal}`` on each descriptor whose `file`
   matches a link path and whose `[startLine, endLine]` span contains the link
   line. The producer (`list-tests.mjs`) applies it after segmentation, so
   anchored descriptors reach `/test-report` and `ingestTestReport`'s **existing**
   anchor path fires deterministically. No new graph code — the inline links
   already authored (by hand, the backfill cron, or `/lore-suggest-links`)
   become live `validated_by` + `violated` signal on every run.

2. **Resolve the binding 1:1; report the N:1 case.** `TestDescriptor.spec` is a
   single string. A descriptor whose span resolves to more than one distinct
   statement is left unanchored and the ambiguity is reported — never silently
   collapsed to one. Multi-anchor (`spec: string[]`) is a deliberate follow-up.

3. **Make the ingest result observable.** The agent surfaces
   `ingestTestReport`'s real `{validatedBy, violated, coverageNodes}` per ingest
   (structured log + audit row) instead of discarding it.

## Consequences

**Positive**
- The `violated` signal becomes producible: a linked test that fails now flips
  its statement to `violated` on the next `main` run — the coupling source's
  top-ranked collision.
- Zero LLM, zero new graph schema; deterministic and idempotent (rides
  `ingestTestReport`'s xid upserts).
- The inline links gain a *dynamic* payoff, reinforcing the hand/cron/skill
  authoring loop the rest of the platform already invests in.

**Negative / risks**
- A test validating several statements gets no anchor until multi-anchor lands
  (mitigated: reported, and the sentence path still covers describe-chain cases).
- The producer must read the repo's spec markdown during `list` — a bounded,
  local filesystem scan, no network.

## Alternatives Considered

- **Server-side derivation at ingest.** Let the agent load spec links and stamp
  anchors inside `ingestTestReport`. Rejected: the agent would need raw spec
  markdown it doesn't hold, and it splits the binding away from the producer
  that owns descriptor discovery.
- **Adopt the `<spec> | <sentence> | <label>` describe convention repo-wide.**
  Rejected: a large, perpetual manual burden on every test author for a binding
  the inline links already express deterministically.
