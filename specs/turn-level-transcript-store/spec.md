# Feature Specification: Turn-Level Transcript Store

| Field   | Value                                    |
|---------|------------------------------------------|
| Feature | Turn-Level Transcript Store              |
| Branch  | `feat/turn-level-transcript-store`       |
| Status  | Draft                                    |
| Created | 2026-08-07                               |
| Owner   | Platform Engineering                     |

The Turn-Level Transcript Store keeps the full-fidelity agent run stream in a new `pipeline.agent_run_turns` table written at the same ingest tee that already produces the cost rows and the truncated run-visualization projection, so "what exactly did the agent see and say at the step that went wrong" becomes a SQL question instead of a GCS spelunking expedition. This specification supersedes [ADR-042](../../adrs/ADR-042-turn-level-transcript-store.md), which is deleted on this branch; the decision, its rejected alternatives and its consequences are carried below.

## Problem Statement

Lore records every agent run twice, and neither record answers a
post-mortem question.

`pipeline.agent_run_events` is a deliberate **projection**. The Floor route
`apps/floor/src/delivery/http/routes/agent-events.ts` maps each stream-json
line through `apps/floor/src/jobs/agent/agent-run-events.ts`, whose
`truncateForStorage` caps a tool result at 2048 bytes and each tool-input
value at 1024 bytes (with a 4096-byte whole-input budget and a
200-character summary cap), then prunes the rows after 14 days. That shape
is exactly right for its consumer — the SSE live run view of ADR-037 — and
wrong for a post-mortem by construction.

The raw NDJSON is not discarded either: the same route fires
`archiveRaw` → `archiveAgentEvents`, redacting the body and writing it to
GCS fire-and-forget. That archive has **no read path**, no turn structure,
no correlation columns, and a bucket lifecycle rule for retention. It
answers "what happened, eventually, if you go get the object and parse it
yourself".

So the missing capability is not a storage engine. Full fidelity is lost
to a **truncation policy** on a Postgres write path that already exists,
already correlates rows to assembly-line nodes at write time, and already
runs under the operated posture of `lore-db`. The fix is a sibling table
fed at the same tee, not a new database.

## Goals & Non-Goals

- The first cut delivers storage plus a cursor-paged read API: the table, the repository port with its Postgres adapter and in-memory double, the flagged ingest tee, and one HTTP read route.
- The turn-view UI is **out of scope**. This feature stops at the read API; rendering turns on the run detail page is a follow-up.
- The new write is **non-authoritative** until piloted. The projection, the SSE live view and the GCS archive keep working byte-for-byte as they do today whether the flag is on or off.

## FR1 — The `pipeline.agent_run_turns` table

Migration `0037_agent_run_turns.sql` under
`infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`
adds the table, applied by the same `pre-install,pre-upgrade` Helm hook as
every other migration.

- The table stores one row per stream-json line with the **untruncated** envelope in a JSONB column, alongside the same correlation columns `agent_run_events` carries: `task_id`, `agent_cr_name`, `assembly_line_id`, `node_id`, `iteration`, plus the raw line kind in `event_type`.
- `id` is a `BIGINT GENERATED ALWAYS AS IDENTITY` primary key that doubles as the read cursor, so it is carried as a string-encoded bigint across every boundary and never narrowed to a JS number.
- The table carries **no foreign keys**, on `task_id` and `assembly_line_id` alike: ingest is a batch insert and one bad row under a FK would abort the whole statement and drop the batch.
- `task_id` is nullable, unlike the projection's `NOT NULL` column, so a line the subsystem never attributed to a task is still stored rather than dropped.
- Retention is 90 days — six times the projection's 14 — because the table exists precisely for questions asked after the live view has moved on, and the prune runs on the existing `eventsPrune` housekeeping tick.
- The migration is idempotent: every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, and the `lore_ui` grant is guarded by a role-existence check, so re-running it on a deploy that changed nothing is a no-op.
- Three indexes cover the three access paths: `(assembly_line_id, id)` for the per-line read, `(task_id, id)` for the per-task read that reaches uncorrelated rows, and `(created_at)` for the retention prune.

## FR2 — The `AgentRunTurnsRepository` port

`libs/shared/src/project/agent-run-turns/agent-run-turns-{port,pg,memory}.ts`
mirrors the sibling `agent-run-events/` triple: one port interface, a
Postgres adapter, an in-memory double that is the behavioral spec, and one
colocated test suite exercising both.

- `insertBatch` resolves `agentCrName` to (`assemblyLineId`, `nodeId`, `iteration`) against `pipeline.assembly_line_nodes` at write time, taking the newest matching node row when two lines collide on a CR name.
- A row whose `agentCrName` matches no node row is still inserted, with `agentCrName` retained and the three correlated fields left null — skip-not-fail, because ingest must never lose a batch.
- One uncorrelated row never suppresses the rest of its batch: the remaining rows insert normally.
- `insertBatch` returns the persisted rows ascending by id, comparing ids numerically rather than lexicographically so a bigint cursor cannot page backwards past 10 digits.
- The batch crosses to Postgres as a **single bound `jsonb` parameter** expanded by `jsonb_to_recordset`, never a string-built `VALUES` list: turn envelopes carry agent-controlled text that must never reach statement text.
- The envelope crosses the port as JSON **text** and is cast to `jsonb` inside the statement, so the ingest path never re-serializes a payload it is already holding as a string.
- An empty batch issues no query at all and returns an empty array.
- `listByLine` returns one assembly line's turns ascending by id, above a cursor and capped by a limit, so a reader pages a finished run without gaps or duplicates.
- `listByTask` reads the same way scoped to a task id, which is the only way to reach the rows that deliberately correlate to no node.
- `pruneOld` deletes rows older than a day horizon and returns the count deleted.

## FR3 — The ingest tee

The collector lives at `apps/floor/src/jobs/agent/agent-run-turns.ts` and
is driven from the **existing single pass** in `parseAgentSink`
(`apps/floor/src/jobs/agent/agent-events.ts`), the same loop that already
produces the cost rows and the projection rows.

- Turn collection is gated on the `LORE_AGENT_TURNS` feature flag and is **off** unless it is set to `1`: with the flag off no turn is collected and no turn is written.
- With the flag off the sink's cost rows and run-visualization rows are byte-for-byte what they are today, so enabling or disabling the store cannot move the projection, the SSE view or the archive.
- A turn is built from the envelope the single pass **already parsed** — the collector re-parses nothing and re-serializes nothing, taking the raw line the scanner already yielded as the stored envelope.
- The stored envelope is redacted with the same `redactSecrets` the GCS archive uses, before it ever reaches the database, because a queryable store raises a redaction miss from "buried in GCS" to "searchable".
- Redaction is verified not to have broken the line's JSON: an unchanged line is kept as-is, and a redacted line that no longer parses is dropped rather than risking a batch-wide insert failure.
- A line the subsystem attributed to no task is still collected, carrying a null task id, matching the table's nullable column.
- Collection is capped per POST at the same order as the projection's cap, so a pathological multi-megabyte report cannot materialize an unbounded row set on the single Floor replica.
- Turn collection is skipped entirely for an oversized body, reusing the projection's existing `MAX_VIZ_BODY_BYTES` gate rather than adding a second size rule.
- A failure to persist turns is counted and logged, never propagated: cost accounting is the sink's contract and a non-authoritative store must not be able to fail it.

## FR4 — The read API

`GET /api/agent-turns/{assemblyLineId}` on the Floor HTTP server mirrors
the existing `GET /api/agent-events/{assemblyLineId}` history route: same
`ingest-token` auth, same clamped cursor and limit parsing.

- The route reads one assembly line's turns through `listByLine`, scoping rows by line **and** cursor rather than by cursor alone.
- The limit is clamped to a maximum and falls back to a default for a missing, non-numeric, zero or negative value, because the token is shared with the web-ui and an unbounded limit would be an unbounded read.
- The cursor falls back to `0` for anything that is not a run of digits, so a malformed `after` reads the run from its start instead of erroring.

## Alternatives rejected

- **Adopt StrongDM's CxDB as a sidecar** (the decision an earlier draft of
  ADR-042 carried). Rejected on two grounds. Provenance: the CxDB codebase
  is entirely agent-written with no human review, which is not an
  acceptable custodian for the org's most sensitive transcripts.
  Operational surface: it is a third database technology and a Rust
  operational surface for a team whose platform expertise is Postgres, in
  a ~6-month-old project with no stability commitments. Its distinctive
  capability — O(1) DAG branching of conversation heads — is not
  load-bearing here: line runs are append-only, and ADR-041-style forking
  operates at node granularity, not turn granularity.
- **Widen `agent_run_events` to full fidelity.** Rejected by the
  projection's own design: truncation is what keeps the live path cheap,
  and ADR-037 separates projection from record deliberately. Widening it
  would trade a working live view for a worse archive.
- **Index the GCS archive.** Batch-parseable but structurally turn-blind —
  raw provider NDJSON, keyed by receipt timestamp, with no correlation
  columns — so every consumer re-implements the parsing forever. A live
  read path from GCS was already ruled out in ADR-037.
- **Do nothing.** The gap is the platform's weakest observability flank
  and the blocker for two follow-ups already sketched: full-fidelity node
  context carryover, and turn-level replay tooling.

## Consequences

- One migration plus a widened tee in an existing route: no new service,
  no new ingress, no new credential surface. That absence of new
  operational surface is the decisive difference from the CxDB draft.
- The real cost moves to `lore-db` storage. Full-fidelity JSONB turns grow
  faster than the truncated projection; the 90-day prune and the per-POST
  cap bound it, and content-addressed dedup of repeated blobs stays the
  escape hatch if measured growth demands one.
- Debugging economics change: full-fidelity, correlated, cursor-paged turn
  history in SQL — the same access idiom as every other Floor
  investigation, with no new query surface to learn.
- Redaction becomes more load-bearing. A queryable store raises the stakes
  of a redaction miss from "buried in GCS" to "searchable", which is why
  the redaction step is specified as a tested control on the write path
  rather than a courtesy.
- The flag must be piloted before anything depends on the store. Until
  then it is a second, richer archive that nothing reads by default.

## Out of Scope

- The turn-view UI on the run detail page. This feature stops at the read
  API.
- Retiring or shortening the GCS raw archive. It stays exactly as it is
  until the pilot proves the table.
- Content-addressed dedup of repeated blobs, and any storage-side
  compression beyond what Postgres TOAST does for free.
- Wiring full-fidelity node context carryover or turn-level forking to the
  store. Both are named as motivation, neither is built here.
- A `lore_ui` read path or web-ui proxy. The migration grants `SELECT` so
  the UI follow-up needs no schema change, but no UI code is added.
