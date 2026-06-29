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
[`projectSpecFile`](../libs/shared/src/spec-trace/project-spec-file.ts) turns it into
a `Statement.validated_by` edge at ingest.

The **run side** is the source of truth for *whether that test passed*:
[`lore-tests.yml`](../.github/workflows/lore-tests.yml) POSTs ~2.4k test
descriptors + results to `/api/repos/:o/:r/test-report` on every push to `main`,
and [`ingestTestReport`](../libs/shared/src/spec-trace/ingest-test-report.ts) projects
them — already setting `Statement.validated_by` **and** `Statement.violated`
when a descriptor carries a `spec` anchor (`path#ordinal`).

The gap: the producer
([`descriptorsFromVitestList`](../libs/shared/src/spec-trace/trace-descriptors.ts))
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
   [`linksForStatements`](../libs/shared/src/spec-link-parser.ts) to index every
   statement's inline test links by `(path, line)`, then stamps
   `descriptor.spec = `${specPath}#${ordinal}`` on each descriptor whose `file`
   matches a link path and whose `[startLine, endLine]` span contains the link
   line. The producer (`list-tests.mjs`) applies it after segmentation, so
   anchored descriptors reach `/test-report` and `ingestTestReport`'s **existing**
   anchor path fires deterministically. No new graph code — the inline links
   already authored (by hand, the backfill cron, or `/lore-suggest-links`)
   become live `validated_by` + `violated` signal on every run.

2. **Bind one-to-many.** `TestDescriptor.spec` is `string | string[]`. A
   descriptor whose span resolves to a single statement carries that one anchor
   (a string); a span resolving to several carries them all (a `string[]`), and
   `parseSpecAnchors` normalizes either shape so `ingestTestReport` contributes
   the test's TestChunk to every anchored statement.

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
- The producer must read the repo's spec markdown during `list`, and parse each
  test file for `it` line spans — a bounded, local filesystem scan, no network.
- `vitest list --json` is line-blind, so binding rides a regex `it`/`test`
  declaration scan (`resolveTestLines`); a test whose leaf name does not match a
  declaration stays line-blind and unbound (graceful — no false anchor).

## Amendment (2026-06-26): specs/ADRs join the same trigger lane, CI-driven

This ADR made the agent's `/api/trigger/spec-trace` handler observable for the
**payload-carried** kinds (`test-report`, `coverage`). Spec/ADR projection into
the graph used a *different*, heavier path: an auto fan-out
(`maybeAutoIngestGraph`) created `ingest-specs` / `ingest-adrs` **pipeline tasks**
on every ingest, which the coordinator dispatched to `runIngestGraph`. Those
deterministic, PR-less runs surfaced as junk rows on the Assembly Lines view and
had no compute justification (projecting markdown is just parsing).

**Decision:** spec/ADR projection now flows through the *same*
`/api/trigger/spec-trace` lane as test-report/coverage, and the `ingest-specs` /
`ingest-adrs` pipeline task type is removed.

- The lane handler dispatches by kind family: **payload-carried** kinds
  (`test-report`, `coverage`) keep going to `ingestSpecTrace`; **repo-read** kinds
  (`specs`, `adrs`) build the GitHub-backed repo reader (`projectFor`) and run the
  same `runIngestGraph` core via `projectRepoGraph` — reading the repo at the
  posted commit and writing Dgraph inside the cluster. (`apps/floor/.../spec-trace-dispatch.ts`.)
- The **kickoff is CI-owned**, mirroring `lore-tests.yml`: `lore-ingest.yml` fans
  out one job *per kind* (`strategy.matrix.kind: [specs, adrs]`, `fail-fast: false`)
  that POSTs `{kinds:[<kind>], commit}` to `/api/repos/:o/:r/ingest-graph`, which
  fires the trigger. Each kind is its own parallel CI run. The server-side auto
  fan-out from `/api/ingest` is deleted; the endpoint scope drops `admin`→`write`
  (no task creation).
- `ingest-tests` as a graph-ingest pipeline task is **removed** (2026-06-29): test
  projection is CI-driven too, the same as specs/ADRs. The repo's `lore-tests.yml`
  runs the project's suite and POSTs `/test-report` + `/coverage` directly — no
  pipeline task, no agent definition. (The cluster `ingest-tests` task was a
  self-skipping no-op anyway: the suite only runs in CI / a local sandbox, never on
  the shared agent.)
- Observability (point 3) extends to the repo-read family: each run emits a
  `graphIngestLogLine` + a `spec_trace_ingest` audit row carrying
  `projected`/`skipped`/`failed`/`status`.
- **Ordering caveat:** specs and adrs project as independent parallel jobs, so a
  statement's best-effort `DECIDED_BY` edge to an ADR cited in the *same push* may
  attach on a later run (next spec change or a `force` re-projection); in steady
  state the ADR is already in the graph and resolves immediately.

Trade-off: a doc projection no longer has a `pipeline.tasks` row (status history,
auto-retry). For an idempotent, content-hash-gated markdown parse that re-runs on
the next ingest, the log line + audit row suffice — the same trade the
test-report lane already accepts.

## Alternatives Considered

- **Server-side derivation at ingest.** Let the agent load spec links and stamp
  anchors inside `ingestTestReport`. Rejected: the agent would need raw spec
  markdown it doesn't hold, and it splits the binding away from the producer
  that owns descriptor discovery.
- **Adopt the `<spec> | <sentence> | <label>` describe convention repo-wide.**
  Rejected: a large, perpetual manual burden on every test author for a binding
  the inline links already express deterministically.
