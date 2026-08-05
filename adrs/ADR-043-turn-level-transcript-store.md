---
adr_number: 43
title: "Turn-level transcript store for agent runs"
status: draft
date: 2026-08-05
domains: [observability, floor, architecture, storage]
---

# ADR-043: Turn-level transcript store for agent runs

This ADR proposes adding a full-fidelity, queryable, turn-level store for
agent run transcripts — evaluating StrongDM's CxDB as a self-hosted sidecar
before committing to building an equivalent — to close the gap between
Lore's truncated run projections and its write-only raw archive.

## Context

Lore records agent runs twice, and neither record answers a debugging
question well. `pipeline.agent_run_events` is a deliberate projection:
write-time truncation, 14-day prune, shaped for the live run view (ADR-037
records why the projection exists and why the archive cannot serve a live
view). The raw stream goes to GCS via fire-and-forget `archiveRaw` — a
write-only NDJSON archive under lifecycle pruning, with no read path, no
indexing, and no turn structure.

The consequence: "what exactly did the agent see and say at the step that
went wrong" — the first question of every run post-mortem, and the input
any full-fidelity context carryover or replay-with-different-prompt tooling
would need — has no queryable answer.

CxDB (Apache-2.0, StrongDM) is purpose-built for exactly this record: an
immutable turn DAG (contexts are head pointers into shared history),
content-addressed blob storage (BLAKE3 dedup + zstd, claimed 70%+ storage
reduction), O(1) branch-from-any-turn, a dual binary/HTTP API, and a React
turn-visualization frontend. It is young (public since 2026-02, ~500
stars) and its codebase is agent-written under StrongDM's no-human-review
rule — a provenance fact colleagues should weigh explicitly.

## Decision

Phase 1 (this ADR's commitment): the ai-agent-subsystem supervisor's
existing NDJSON POST is teed, behind a feature flag on a pilot repo, into a
CxDB instance deployed as a sidecar service in the platform (one subchart,
its own PVC; no cluster-external egress). The run detail page links to the
turn view for piloted runs. Success criteria: post-mortems answered from
turns instead of GCS spelunking; storage within projections; no ingest-path
regressions.

Phase 2 (explicitly deferred to a follow-up decision): retiring the GCS
archive, wiring full-fidelity node context carryover and ADR-042-style
turn-level forking to the store, or replacing CxDB with an in-house
Postgres turn store if operating a Rust sidecar proves the wrong trade.

## Alternatives rejected

- **Widen `agent_run_events` to full fidelity.** Explicitly rejected by the
  projection's design: truncation is what keeps the live path cheap, and
  ADR-037 separates projection from record deliberately.
- **Index the GCS archive.** Batch-parseable but structurally turn-blind
  (raw provider NDJSON, no DAG, no dedup); every consumer re-implements
  parsing forever.
- **Build the turn store in Postgres first.** Plausible endgame, but
  building before piloting forfeits the cheap experiment; the tee makes
  CxDB removable in an afternoon.

## Consequences

- A new stateful service to operate (Rust, local-disk storage) — accepted
  for the pilot precisely because the tee is non-authoritative and
  removable; nothing downstream depends on it until Phase 2.
- Debugging economics change: full-fidelity turn history with dedup instead
  of truncated events plus unreadable archives.
- Transcript privacy surface grows: the existing redaction
  (`sanitizeContent`/`redactSecrets`) must run before the tee, exactly as
  it does before the GCS archive today.
- Dependency risk is bounded and named: Apache-2.0 permits forking; the
  pilot's exit criteria include "we could rebuild the schema in Postgres if
  StrongDM abandons it."
