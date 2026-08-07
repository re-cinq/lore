# Feature Specification: Turn-Level Transcript Store for Agent Runs

| Field     | Value                                                  |
| --------- | ------------------------------------------------------ |
| Feature   | Turn-Level Transcript Store for Agent Runs             |
| Branch    | docs/convert-field-survey-adrs-to-specs                |
| Status    | Shipped                                                |
| Created   | 2026-08-07                                             |
| Owner     | Platform Engineering                                   |
| Builds on | [ADR-037](../../adrs/ADR-037-sse-run-observability.md) |

The Turn-Level Transcript Store is a full-fidelity, queryable, turn-level
store for agent run transcripts built on the Postgres the platform already
operates — a sibling table beside the truncated projection, fed at the same
ingest tee — closing the gap between Lore's truncated run projections and
its write-only raw archive without adding a third database technology.

## Problem Statement

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

The field survey that seeded this feature pointed at StrongDM's CxDB
(Apache-2.0), a purpose-built immutable turn DAG with content-addressed
dedup and O(1) branch-from-any-turn. An earlier draft proposed piloting it
as a sidecar. Review pushed back on provenance (the CxDB codebase is
agent-written with no human review — a hard fact for a service holding
sensitive transcripts), and a closer look at the stack removed the premise:
the platform already operates two databases (Postgres via CloudNativePG,
Dgraph for the spec-trace graph), and the turn data already flows through a
Postgres write path today. Full fidelity is lost to a truncation policy,
not to a missing storage engine.

## Functional Requirements

### FR1 — The `pipeline.agent_run_turns` table

- A new table, `pipeline.agent_run_turns` (ordered migration 0037), stores one row per stream-json line with the untruncated content in JSONB and the same write-time correlation as the projection: `agentCrName` resolves to (`assemblyLineId`, `nodeId`, `iteration`) at insert. ([validated by `agent-run-turns.test.ts:37`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L37))
- A row that correlates to no node is kept with the correlated fields null rather than dropped — skip-not-fail, like every ingest write on this route. ([validated by `agent-run-turns.test.ts:62`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L62))
- The batch crosses to Postgres as a single bound jsonb parameter (payloads carry agent-controlled text that must never reach statement text), and an empty batch issues no query. ([validated by `agent-run-turns.test.ts:116`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L116), [`agent-run-turns.test.ts:130`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L130), [`agent-run-turns.test.ts:75`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L75))
- The store exposes a per-line ascending read — the turn view's query, and the reason this table is not a second write-only archive. ([validated by `agent-run-turns.test.ts:82`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L82))

### FR2 — Fed at the existing tee, behind a pilot flag

- The turn rows are collected in the same single-pass parse that produces the cost rows and the run-viz projection, at the same tee point in the agent-events route — one turn per attributed line, keeping the line's own stream kind (`system` / `assistant` / `user` / `result` / `log`). ([validated by `agent-turns.test.ts:83`](apps/floor/src/jobs/agent/agent-turns.test.ts#L83), [`agent-turns.test.ts:11`](apps/floor/src/jobs/agent/agent-turns.test.ts#L11))
- The tee is off by default and opts in via the `LORE_AGENT_TURNS` feature flag; when off, no turns are collected or written, and the projection, the SSE view, and the GCS archive are untouched either way — the new write is non-authoritative until the pilot proves it. ([validated by `agent-turns.test.ts:61`](apps/floor/src/jobs/agent/agent-turns.test.ts#L61), [`agent-turns.test.ts:93`](apps/floor/src/jobs/agent/agent-turns.test.ts#L93))
- A task-less line and an unknown line kind are dropped, mirroring the projection's forward-compat contract. ([validated by `agent-turns.test.ts:54`](apps/floor/src/jobs/agent/agent-turns.test.ts#L54))

### FR3 — Redaction before write

- The existing secret-redaction path (`redactSecrets`, the same patterns the GCS archive runs) is applied to every turn payload before it is stored; a queryable store raises the stakes of any redaction miss from "buried in GCS" to "searchable", so this is a security control with test coverage, not a courtesy. ([validated by `agent-turns.test.ts:32`](apps/floor/src/jobs/agent/agent-turns.test.ts#L32))

### FR4 — Retention

- Retention is longer than the projection's 14 days — 90 days, pruned on the `created_at` horizon by the same events-prune cron that reaps the projection. The table exists precisely for questions asked after the live view has moved on. ([validated by `agent-run-turns.test.ts:102`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L102), [`agent-run-turns.test.ts:137`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L137))

## Open Questions — pilot exit criteria

- Post-mortems answered from turns instead of GCS spelunking.
- Table growth monitored, with the pilot pausing for review if it exceeds
  the sized estimate.
- No ingest-path regressions.
- The run detail page's turn view reading this table for piloted runs is a
  follow-up once the pilot writes data worth rendering.

## Out of Scope (Phase 2, deferred to a follow-up decision)

- Retiring or shortening the GCS archive.
- Wiring full-fidelity node context carryover and turn-level forking
  ([fork-rerun-from-node](../fork-rerun-from-node/spec.md)) to the store.
- Content-addressed dedup of repeated blobs if measured growth warrants it.

## Alternatives rejected

- **Adopt CxDB as a sidecar (the earlier draft's decision).** Rejected: a
  third database technology and a Rust operational surface for a team
  whose platform is Postgres expertise; a codebase that is entirely
  agent-written with no human review, holding the org's most sensitive
  transcripts; a ~6-month-old project with no stability commitments. Its
  distinctive capability — O(1) DAG branching of conversation heads — is
  not load-bearing here: line runs are append-only, and
  [fork-rerun-from-node](../fork-rerun-from-node/spec.md) forking operates
  at node granularity, not turn granularity.
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

- One migration plus a widened tee in an existing route: no new service,
  no new ingress, no new credential surface — the store inherits the
  operated posture of `lore-db`, which is the decisive difference from the
  CxDB draft.
- The real cost moves to `lore-db` storage: full-fidelity JSONB turns grow
  faster than the truncated projection. The pilot's growth measurement and
  the 90-day prune bound it; Phase 2's dedup is the escape hatch if
  measurement demands one.
- Debugging economics change: full-fidelity, correlated, queryable turn
  history with SQL — the same access idiom as every other Floor
  investigation, no new query surface to learn.
