---
adr_number: 42
title: "Turn-level transcript store for agent runs"
status: draft
date: 2026-08-05
deciders: []
domains: [observability, floor, architecture, storage]
---

# ADR-042: Turn-level transcript store for agent runs

This ADR proposes a full-fidelity, queryable, turn-level store for agent run
transcripts built on the Postgres the platform already operates — a sibling
table beside the truncated projection, fed at the same ingest tee — closing
the gap between Lore's truncated run projections and its write-only raw
archive without adding a third database technology.

## Context

Lore records agent runs twice, and neither record answers a debugging
question well. `pipeline.agent_run_events` is a deliberate projection: the
Floor route (`apps/floor/src/delivery/http/routes/agent-events.ts`) maps
each stream line and truncates at write time — `truncateForStorage` caps
tool-result content at 2048 bytes and each tool-input value at 1024 bytes,
marking the cut — into a JSONB `payload` column, pruned after 14 days.
That shape is correct for its consumer (the SSE live run view, ADR-037)
and wrong for post-mortems by design. The raw NDJSON goes to GCS via the
same route's fire-and-forget `archiveRaw` → `archiveAgentEvents` — a
write-only archive with no read path, no turn structure, and lifecycle
pruning.

The consequence: "what exactly did the agent see and say at the step that
went wrong" — the first question of every run post-mortem, and the input
any full-fidelity context carryover or replay-with-different-prompt tooling
would need — has no queryable answer.

The field survey that seeded this ADR pointed at StrongDM's CxDB
(Apache-2.0), a purpose-built immutable turn DAG with content-addressed
dedup and O(1) branch-from-any-turn. An earlier draft of this ADR proposed
piloting it as a sidecar. Review pushed back on provenance (the CxDB
codebase is agent-written with no human review — a hard fact for a service
holding sensitive transcripts), and a closer look at the stack removed the
premise: the platform already operates two databases (Postgres via
CloudNativePG, Dgraph for the spec-trace graph), and the turn data already
flows through a Postgres write path today. Full fidelity is lost to a
truncation policy, not to a missing storage engine.

## Decision

- A new table, `pipeline.agent_run_turns`, stores the full-fidelity turn
  stream: same correlation columns as `agent_run_events` (task, assembly
  line, node, agent CR name, event type), with the untruncated content in
  JSONB. Added by an ordered migration like every other schema change.
- It is fed at the same tee point in the agent-events route where the
  projection and the archive already fork, behind a feature flag scoped to
  a pilot repo. The projection, the SSE view, and the GCS archive are
  untouched — the new write is non-authoritative until the pilot proves
  it.
- The existing redaction path (`sanitizeContent`/`redactSecrets`) runs
  before the write, exactly as it does for the archive today. No new
  service, no new ingress, no new credential surface: the store inherits
  the operated posture of `lore-db`.
- Retention is longer than the projection's 14 days (initial: 90 days,
  prunable) — the table exists precisely for questions asked after the
  live view has moved on.
- The run detail page gains a turn view reading this table for piloted
  runs. Success criteria: post-mortems answered from turns instead of GCS
  spelunking; table growth monitored with the pilot pausing for review if
  it exceeds the sized estimate; no ingest-path regressions.

Phase 2 (explicitly deferred to a follow-up decision): retiring or
shortening the GCS archive, wiring full-fidelity node context carryover
and ADR-041-style turn-level forking to the store, and content-addressed
dedup of repeated blobs if measured growth warrants it.

## Alternatives rejected

- **Adopt CxDB as a sidecar (the earlier draft's decision).** Rejected: a
  third database technology and a Rust operational surface for a team
  whose platform is Postgres expertise; a codebase that is entirely
  agent-written with no human review, holding the org's most sensitive
  transcripts; a ~6-month-old project with no stability commitments. Its
  distinctive capability — O(1) DAG branching of conversation heads — is
  not load-bearing here: line runs are append-only, and ADR-041's forking
  operates at node granularity, not turn granularity.
- **Widen `agent_run_events` to full fidelity.** Explicitly rejected by the
  projection's design: truncation is what keeps the live path cheap, and
  ADR-037 separates projection from record deliberately.
- **Index the GCS archive.** Batch-parseable but structurally turn-blind
  (raw provider NDJSON, no correlation columns); every consumer
  re-implements parsing forever, and a live read path from GCS was already
  ruled out in ADR-037.
- **Do nothing.** The gap is the platform's weakest observability flank and
  the blocker for two accepted-if-approved follow-ups (context carryover,
  turn-level replay tooling).

## Consequences

- One migration plus a widened tee in an existing route: no new
  operational surface, which is the decisive difference from the CxDB
  draft.
- The real cost moves to `lore-db` storage: full-fidelity JSONB turns grow
  faster than the truncated projection. The pilot's growth measurement and
  the 90-day prune bound it; Phase 2's dedup is the escape hatch if
  measurement demands one.
- Debugging economics change: full-fidelity, correlated, queryable turn
  history with SQL — the same access idiom as every other Floor
  investigation, no new query surface to learn.
- Redaction becomes more load-bearing: a queryable store raises the
  stakes of any redaction miss from "buried in GCS" to "searchable". The
  sanitize path must be treated as a security control with test coverage,
  not a courtesy.
