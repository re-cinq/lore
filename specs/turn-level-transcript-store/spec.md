# Feature Specification: Turn-Level Transcript Store

| Field   | Value                                    |
|---------|------------------------------------------|
| Feature | Turn-Level Transcript Store              |
| Branch  | `feat/turn-level-transcript-store`       |
| Status  | In Progress                              |
| Created | 2026-08-07                               |
| Owner   | Platform Engineering                     |

The Turn-Level Transcript Store keeps the full-fidelity agent run stream in a new `pipeline.agent_run_turns` table written at the same ingest tee that already produces the cost rows and the truncated run-visualization projection, so "what exactly did the agent see and say at the step that went wrong" becomes a SQL question instead of a GCS spelunking expedition. This specification supersedes ADR-042, deleted on this branch, and carries its decision, its rejected alternatives and its consequences below.

## Problem Statement

Lore already records every agent run three times over, and none of the
three answers a post-mortem question.

`pipeline.agent_run_events` is a deliberate **projection**. The Floor route
`apps/floor/src/transport/http/routes/agent-events.ts` maps each stream-json
line through `apps/floor/src/work/agent/agent-run-events.ts`, whose
`truncateForStorage` caps a tool result at 2048 bytes and each tool-input
value at 1024 bytes (with a 4096-byte whole-input budget and a
200-character summary cap), then prunes the rows after 14 days. That shape
is exactly right for its consumer — the SSE live run view of ADR-037 — and
wrong for a post-mortem by construction.

The raw NDJSON was not discarded either: when this spec was written the
same route fired `archiveRaw` → `archiveAgentEvents`, redacting the body
and writing it to GCS fire-and-forget. That archive had **no read path**,
no turn structure, no correlation columns, and a bucket lifecycle rule for
retention. It answered "what happened, eventually, if you go get the
object and parse it yourself". *(Superseded 2026-08-11, #1148: the archive
is retired; this store is the raw record.)*

The third record is the pod log, and it is the closest thing to a durable
transcript Lore has today. `GET /api/agent-logs/{name}`
(`apps/floor/src/transport/http/routes/agent-logs.ts`) serves an agent's
stdout live from the pod (`KubePodLogs`) and falls back to the Cloud
Logging archive (`CloudLoggingPodLogs` in
`apps/floor/src/work/station/agent-pod-logs.ts`) after the pod is
garbage-collected; the run page's per-node log panel renders it today. It
does answer "what did this one pod print" — but per CR name only,
unstructured, tail-limited, at Cloud Logging's retention, outside
Postgres. It cannot join a turn to its assembly-line node, answer a
cross-node or per-task question, or be queried with SQL at all.

So the missing capability is not a storage engine, and the delta this
feature buys is structure, not existence. Full fidelity is lost
to a **truncation policy** on a Postgres write path that already exists,
already correlates rows to assembly-line nodes at write time, and already
runs under the operated posture of `lore-db`. The fix is a sibling table
fed at the same tee, not a new database.

## Goals & Non-Goals

- The first cut delivers storage plus a cursor-paged read API: the table, the repository port with its Postgres adapter and in-memory double, the flagged ingest tee, and one HTTP read route.
- The turn-view UI was **out of scope** for the first cut, which stopped at the read API. *(Superseded by the #1148 follow-up:)* the run detail page now renders turns in a full-transcript panel (FR5), and the task-keyed read route exists (FR4).
- The write is live from the first deploy. There is no flag and no pilot, so the projection and the SSE live view continuing to work byte-for-byte is a property that has to be tested rather than a state an operator can restore by flipping something off. (This originally listed the GCS archive too; it was retired the same day, #1148.)

## FR1 — The `pipeline.agent_run_turns` table

Migration `0037_agent_run_turns.sql` under
`deploy/chart/charts/ui-helm/migrations/`
adds the table, applied by the same `pre-install,pre-upgrade` Helm hook as
every other migration.

- The table stores one row per stream-json line with the **untruncated** envelope in a JSONB column, alongside the same correlation columns `agent_run_events` carries: `task_id`, `agent_cr_name`, `assembly_line_id`, `node_id`, `iteration`, plus the raw line kind in `event_type`. ([validated by `agent-run-turns.test.ts@b45462d9`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L137), [`agent-run-turns.test.ts@fd14d149`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L372))
- `id` is a `BIGINT GENERATED ALWAYS AS IDENTITY` primary key that doubles as the read cursor, so it is carried as a string-encoded bigint across every boundary and never narrowed to a JS number. ([validated by `agent-run-turns.test.ts@d3d9bad6`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L161), [`agent-run-turns.test.ts@fd14d149`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L372))
- The table carries **no foreign keys**, on `task_id` and `assembly_line_id` alike: ingest is a batch insert and one bad row under a FK would abort the whole statement and drop the batch.
- `task_id` is nullable, unlike the projection's `NOT NULL` column, so a line the subsystem never attributed to a task is still stored rather than dropped. ([validated by `agent-run-turns.test.ts@f36ce6c9`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L127))
- Retention is 30 days, longer than the projection's 14 because the table exists precisely for questions asked after the live view has moved on, but deliberately conservative: there is no pilot, so no growth measurement justifies a longer horizon yet. The prune runs on the existing `eventsPrune` housekeeping tick and logs its deleted count, which is the only growth signal the feature ships with. ([validated by `cron.test.ts@2336cf09`](libs/shared/src/work/housekeeping/bus-prune.test.ts#L80), [`cron.test.ts@6c592412`](libs/shared/src/work/housekeeping/bus-prune.test.ts#L87), [`agent-run-turns.test.ts@746865c6`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L272), [`agent-run-turns.test.ts@0b8d9378`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L284))
- *(Amended 2026-08-18, #1296:)* the window is an operator knob: `LORE_AGENT_RUN_TURN_RETENTION_DAYS`, read at prune time (the platform's stations chart sets it to 365 since 2026-10-02, so the transcripts of the runs Lore's own engine walked outlive the 30-day default), falling back to the 30-day default — with a warning — when set to anything but an integer in 1..3650 (the cap keeps a pathological value from overflowing Postgres's int32 interval days and failing every hourly tick). This is the same lever the GCS task-log bucket has via the `log_retention_days` terraform variable — both default to 30 days, so retiring the bucket loses no retention at defaults (the issue's "the bucket kept logs indefinitely" premise was wrong). A commented entry in `stations-helm/values.yaml` documents the knob. ([validated by `cron.test.ts@0ee9be4d`](libs/shared/src/work/housekeeping/bus-prune.test.ts#L100), [`cron.test.ts@d9d6bac2`](libs/shared/src/work/housekeeping/bus-prune.test.ts#L106))
- The migration is idempotent: every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, and the `lore_ui` grant is guarded by a role-existence check, so re-running it on a deploy that changed nothing is a no-op.
- Three indexes cover the three access paths: `(assembly_line_id, id)` for the per-line read, `(task_id, id)` for the per-task read that reaches uncorrelated rows, and `(created_at)` for the retention prune.
- *(Amended 2026-08-19, #1389:)* migration `0042_agent_run_turns_dedup.sql` adds a nullable `dedup_key` column and a partial unique index (`WHERE dedup_key IS NOT NULL`) — re-ingest idempotency for the task-turns relay, whose retried POSTs used to duplicate rows. Only the relay stamps keys; every other producer leaves the column NULL and never dedups. This is ingest idempotency for RETRIED lines, not the content-addressed blob dedup the Out of Scope list rejects — that bullet is about storage-side compression of DISTINCT turns, this key names one line's identity at one transcript position. The index build is non-CONCURRENT on a live table (0042's header carries 0031's build-CONCURRENTLY-by-hand escape hatch); live `ON CONFLICT` semantics are proven by the `migrations.yml` fixture rather than the unit suites.

## FR2 — The `AgentRunTurnsRepository` port

`libs/shared/src/outbound/project/agent-run-turns/agent-run-turns-{port,pg,memory}.ts`
mirrors the sibling `agent-run-events/` triple: one port interface, a
Postgres adapter, an in-memory double that is the behavioral spec, and one
colocated test suite exercising both.

- `insertBatch` resolves `agentCrName` to (`assemblyLineId`, `nodeId`, `iteration`) against `pipeline.assembly_line_nodes` at write time, taking the newest matching node row when two lines collide on a CR name. ([validated by `agent-run-turns.test.ts@6f95d207`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L38), [`agent-run-turns.test.ts@84f566a1`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L304))
- A row whose `agentCrName` matches no node row is still inserted, with `agentCrName` retained and the three correlated fields left null — skip-not-fail, because ingest must never lose a batch. ([validated by `agent-run-turns.test.ts@78bce4eb`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L92))
- One uncorrelated row never suppresses the rest of its batch: the remaining rows insert normally. ([validated by `agent-run-turns.test.ts@5e609d2d`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L108))
- `insertBatch` returns the persisted rows ascending by id, comparing ids numerically rather than lexicographically so a bigint cursor cannot page backwards past 10 digits. Both adapters share one comparator, and it is a total order — equal ids compare equal, never "greater". ([validated by `agent-run-turns.test.ts@f1e4a34f`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L239), [`agent-run-turns.test.ts@fd14d149`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L372), [`agent-run-turns.test.ts@e10e63f8`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L466), [`agent-run-turns.test.ts@f6d69c69`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L470), [`agent-run-turns.test.ts@1c062a53`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L476), [`agent-run-turns.test.ts@bc4043ac`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L482))
- The batch crosses to Postgres as a **single bound `jsonb` parameter** expanded by `jsonb_to_recordset`, never a string-built `VALUES` list: turn envelopes carry agent-controlled text that must never reach statement text. ([validated by `agent-run-turns.test.ts@73fc1943`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L339))
- The envelope crosses the port as JSON **text** and is cast to `jsonb` inside the statement, so the ingest path never re-parses a payload it is already holding as a string; the one serialization left is the adapter's single `JSON.stringify` of the whole batch at the Postgres boundary. ([validated by `agent-run-turns.test.ts@f5fb88ee`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L363))
- An empty batch issues no query at all and returns an empty array. ([validated by `agent-run-turns.test.ts@deecaabf`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L173), [`agent-run-turns.test.ts@27d07647`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L297))
- `listByLine` returns one assembly line's turns ascending by id, above a cursor and capped by a limit, so a reader pages a finished run without gaps or duplicates. ([validated by `agent-run-turns.test.ts@51d9379b`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L206), [`agent-run-turns.test.ts@7567f33c`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L214), [`agent-run-turns.test.ts@b98b8377`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L226), [`agent-run-turns.test.ts@4215da31`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L419))
- `listByTask` reads the same way scoped to a task id. It has no production caller today and is kept deliberately: it is the ONLY path that can reach the uncorrelated rows FR1 requires the table to preserve, and a store that keeps rows nothing can ever read would contradict its own reason for keeping them. Delete it only together with the decision to stop storing uncorrelated turns. ([validated by `agent-run-turns.test.ts@6848ce58`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L257), [`agent-run-turns.test.ts@9f9a7f01`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L431))
- `pruneOld` deletes rows older than a day horizon and returns the count deleted. ([validated by `agent-run-turns.test.ts@746865c6`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L272), [`agent-run-turns.test.ts@a50c48c6`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L442))
- *(Amended 2026-08-19, #1389:)* `AgentRunTurnInsert` carries an optional `dedupKey`. A non-null key already stored skips its row — silently, never a batch failure — and `insertBatch` returns only the rows the call actually inserted; a null key never dedups, and pruning a row frees its key. The Pg adapter uses a BARE `ON CONFLICT DO NOTHING`, deliberately naming no arbiter target: naming the partial index would `42P10`-fail every insert against a database missing it, degrading "duplicates" into total turn loss. ([validated by `agent-run-turns.test.ts@3679f689`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L488), [`agent-run-turns.test.ts@969d0bd8`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L500), [`agent-run-turns.test.ts@d2f73217`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L512), [`agent-run-turns.test.ts@c1257bf7`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L521), [`agent-run-turns.test.ts@3c5d1f41`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L536), [`agent-run-turns.test.ts@c4c0c57b`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L549))

## FR3 — The ingest tee

> **2026-10-02.** This section describes Lore's own Floor (`apps/floor`), which was deleted (`specs/external-floor` FR16.10). A run on the external floor keeps its turns in the floor; the rows already in `pipeline.agent_run_turns` are history, read through lore-api (FR16.9); and the local runner's relay, `POST /api/task-turns/{taskId}`, was deleted on 2026-11-13 with the runner. The statements below are kept as the record of how the store was fed and read.

The collector lives at `apps/floor/src/work/agent/agent-run-turns.ts` and
is driven from the **existing single pass** in `parseAgentSink`
(`apps/floor/src/work/agent/agent-events.ts`), the same loop that already
produces the cost rows and the projection rows.

- Turn collection is unconditional: every `/api/agent-events` POST collects turns, with no feature flag and nothing for an operator to switch on.
- Collecting turns perturbs nothing else. The cost rows and the run-visualization rows are byte-for-byte what they would be without the turn store, so the projection and the SSE view are unaffected. With no off switch in production this property is the only thing standing between the store and a regression in the outputs that were already there.
- A turn is built from the envelope the single pass **already parsed** — the collector re-parses nothing and re-serializes nothing, taking the raw line the scanner already yielded as the stored envelope.
- The stored envelope is redacted with the same `redactSecrets` the GCS archive used, before it ever reaches the database, because a queryable store raises a redaction miss from "buried in GCS" to "searchable".
- Redaction is verified not to have broken the line's JSON: an unchanged line is kept as-is, and a redacted line that no longer parses is dropped rather than risking a batch-wide insert failure.
- A dropped turn is counted and warned about, never silent. The private-key pattern is not anchored inside one JSON string, so an agent can emit a `BEGIN`/`END` pair straddling JSON structure and thereby keep its own line out of the transcript; a store justified by fidelity has to make that loss visible.
- Turns left out by the per-batch cap are counted and warned about too, separately from the redaction drops. With both paths counted, every way the sink can lose a turn is visible, which is what lets "this transcript is complete" be read off the metrics instead of assumed.
- A line the subsystem attributed to no task, or of a kind this Floor has never seen, is still collected — carrying a null task id or a null kind, matching the table's nullable columns.
- Collection is capped per POST at the same order as the projection's cap, so a pathological multi-megabyte report cannot materialize an unbounded row set on the single Floor replica.
- Turn collection is skipped entirely for an oversized body, reusing the projection's existing `MAX_VIZ_BODY_BYTES` gate rather than adding a second size rule.
- A failure to persist turns is counted and logged, never propagated: cost accounting is the sink's contract and a non-authoritative store must not be able to fail it.
- *(Amended 2026-08-19, #1389:)* a turn skipped as an already-stored duplicate (its `dedupKey` matched an existing row) is counted (`turn_deduped`) and warned like the two dropped-turn paths: expected on a relay retry, but the only path that could ever swallow a legitimate line, so it must be visible. The relay's collector reads the key from the envelope's `source.turn_key`; pod envelopes carry none.

Since issue #1295 the sink had a second producer besides the ai-agent-subsystem
pods: the mcp-server local runner relayed its redacted stream-json transcript
through lore-api's `POST /api/task-turns/{taskId}`. The runner and the route were
deleted on 2026-11-13; the rows they wrote, task id but no agent CR name and so
uncorrelated to any assembly line, are history that `listByTask` still reaches.

## FR4 — The read API

> **2026-10-02.** This section describes Lore's own Floor (`apps/floor`), which was deleted (`specs/external-floor` FR16.10). A run on the external floor keeps its turns in the floor; the rows already in `pipeline.agent_run_turns` are history, read through lore-api (FR16.9); and the local runner's relay, `POST /api/task-turns/{taskId}`, was deleted on 2026-11-13 with the runner. The statements below are kept as the record of how the store was read before lore-api took the reads over.

`GET /api/agent-turns/{assemblyLineId}` on the Floor HTTP server mirrors
the existing `GET /api/agent-events/{assemblyLineId}` history route.

- The route hands back one assembly line's turns with their envelopes untruncated, behind the same `ingest-token` bearer auth every other Floor read carries.
- The route reads through `listByLine`, scoping rows by line **and** cursor rather than by cursor alone.
- The limit is clamped to a maximum and falls back to a default for a missing, non-numeric, zero or negative value, because the token is shared with the web-ui and an unbounded limit would be an unbounded read; the route reads one lookahead row past the clamped limit to answer `hasMore`.
- The response carries an explicit `hasMore` flag — true only when a row exists past the returned page, with the lookahead row withheld, and always present including on an empty page — so the web-ui walks end on the server's answer instead of comparing page length against a client-side copy of the clamp (#1310).
- The cursor falls back to `0` for anything that is not a run of digits, so a malformed `after` reads the run from its start instead of erroring.

`GET /api/agent-turns/task/{taskId}` is the task-keyed sibling (a #1148
follow-up), reading through `listByTask` — the only path to the
uncorrelated rows FR1 requires the table to preserve, which were otherwise
stored but unreachable over HTTP.

- The task route hands back one task's turns — including rows correlated to no assembly line — behind the same `ingest-token` bearer auth.
- It reads through `listByTask`, scoping rows by task **and** cursor, and its literal `task` path segment never collides with the registered line route sharing the `/api/agent-turns` prefix.
- The limit clamp, default, lookahead and `hasMore` flag are byte-identical to the line route's, for the same shared-token reason.
- The cursor falls back to `0` for a malformed `after`, same as the line route.

## FR5 — The turn-view UI

The run detail page (`apps/web-ui/src/app/assembly-runs/[id]/`) surfaces
the store through a session-authed proxy plus a `FullTranscriptPanel` in
the selected agent attempt's card (the #1148 follow-up; deliberately one
reused panel, not a parallel page, per #1102). The panel started out
collapsed beside a truncated live view; since 2026-09-09 (#1939) it is the
attempt's transcript and is open from the start.

- `GET /api/assembly-runs/[id]/turns` proxies the Floor's line-keyed turns route with the same auth ladder as the sibling events proxy: session (401) → run lookup (404) → repo access (403) → env guard (500). ([validated by `route.test.ts@cf968642`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L45), [`route.test.ts@ee693283`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L54), [`route.test.ts@a74830e5`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L63), [`route.test.ts@ceca98fa`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L74))
- The proxy forwards `after`/`limit` untouched, sends the signed-in person's session token as the bearer, propagates the request's abort signal, returns the Floor's status and body verbatim — except the Floor's own 401/403 (an expired or revoked session token), which surface as 502 so they cannot masquerade as the proxy's session/repo-access ladder — and opts out of route caching. ([validated by `route.test.ts@4ce4136d`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L40), [`route.test.ts@bf81df2b`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L85), [`route.test.ts@78146476`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L95), [`route.test.ts@913263da`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L105), [`route.test.ts@1cbdb68b`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L116), [`route.test.ts@47368572`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L124), [`route.test.ts@07f1396c`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L133), [`route.test.ts@b8e00245`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L145), [`route.test.ts@99bf06e9`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L157), [`route.test.ts@f2e5a692`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L166))
- The row crosses into the web-ui as a hand-mirrored `AgentRunTurn` (web-ui cannot import `@re-cinq/lore-shared`), guarded keys-only by `scripts/type-drift/run-turn-types.drift.ts`; the parser requires the identity fields, keeps every correlation field nullable, keeps unknown event kinds unnarrowed, and never throws. ([validated by `run-turn-types.test.ts@ae286888`](apps/web-ui/src/lib/run-turn-types.test.ts#L21), [`run-turn-types.test.ts@9c3302cc`](apps/web-ui/src/lib/run-turn-types.test.ts#L25), [`run-turn-types.test.ts@31c24561`](apps/web-ui/src/lib/run-turn-types.test.ts#L39), [`run-turn-types.test.ts@b4649899`](apps/web-ui/src/lib/run-turn-types.test.ts#L47), [`run-turn-types.test.ts@46cd0362`](apps/web-ui/src/lib/run-turn-types.test.ts#L51), [`run-turn-types.test.ts@7524f50b`](apps/web-ui/src/lib/run-turn-types.test.ts#L55), [`run-turn-types.test.ts@619dd12b`](apps/web-ui/src/lib/run-turn-types.test.ts#L59))
- The panel renders open and starts its walk on mount, before any click *(amended 2026-11-13: it rendered collapsed and fetched nothing until first opened before #1939)*; reopening it while the first walk is still in flight never starts a second one, and the mount is keyed on the run id so run navigation cannot leak a stale transcript. The page URL and cursor arithmetic are pure presenter functions. ([validated by `FullTranscriptPanel.test.tsx@d4a22554`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L96), [`FullTranscriptPanel.test.tsx@6af30129`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L221), [`turn-transcript-presenter.test.ts@8ae2fe00`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L51), [`turn-transcript-presenter.test.ts@88ea9b92`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L57), [`turn-transcript-presenter.test.ts@1301067d`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L63))
- Once opened it pages the proxy with the cursor, ending the walk on the response's explicit `hasMore` flag when it is a boolean and falling back to the pre-#1310 short-page rule when the flag is absent (an older Floor during deploy skew), reading the cursor off the raw page so one unparseable row cannot end the paging early — and a `hasMore: true` page with no usable cursor still ends the walk — showing the cap notice, since the one-shot walk never retries — rather than refetching itself forever. ([validated by `FullTranscriptPanel.test.tsx@53793357`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L128), [`FullTranscriptPanel.test.tsx@0de71a26`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L354), [`FullTranscriptPanel.test.tsx@f93ae919`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L373), [`FullTranscriptPanel.test.tsx@74f7228d`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L386), [`FullTranscriptPanel.test.tsx@5b323404`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L421), [`turn-transcript-presenter.test.ts@430c2bc3`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L79), [`turn-transcript-presenter.test.ts@88d4174a`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L83), [`turn-transcript-presenter.test.ts@d8edd85a`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L87), [`turn-transcript-presenter.test.ts@45e81614`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L91), [`turn-transcript-presenter.test.ts@91a68635`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L122), [`turn-transcript-presenter.test.ts@95f3bea2`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L128), [`turn-transcript-presenter.test.ts@07bb8f22`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L132), [`turn-transcript-presenter.test.ts@91826682`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L136), [`turn-transcript-presenter.test.ts@f6f35bd4`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L147), [`turn-transcript-presenter.test.ts@508bb747`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L152), [`turn-transcript-presenter.test.ts@e9badef5`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L156), [`turn-transcript-presenter.test.ts@4c4c64df`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L164), [`turn-transcript-presenter.test.ts@e1f887f6`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L169))
- The walk is bounded, never silent about it: it requests the Floor route's maximum page size rather than its default, stops at a hard turn cap or at a per-walk page bound (so a Floor clamp far below the requested page size costs bounded requests, not a storm), and shows a notice carrying the actual loaded count instead of materializing an unbounded run in the tab. ([validated by `FullTranscriptPanel.test.tsx@91e7d98f`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L145), [`FullTranscriptPanel.test.tsx@99b5f9fc`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L402), [`turn-transcript-presenter.test.ts@fae898e1`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L71), [`turn-transcript-presenter.test.ts@0123b6d4`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L75), [`turn-transcript-presenter.test.ts@12004481`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L141))
- It renders the selected node's turns as a formatted conversation by default — one segment per node visit (specs/job-log-streaming FR, `@/lib/turn-segments`), each classified turn shown with its own timestamp via `conversationEntries`/`clockTime`, so a lifecycle marker with no `type` reads as a sentence instead of an unlabeled `unknown` row and an assistant/user turn shows its message text rather than only its kind; switching the selected node refilters the one line-scoped fetch instead of refetching. _(Amended 2026-09-09:)_ the Raw toggle is retired — the panel drew the untruncated envelope behind it, and a reader who wants JSON has `GET /api/agent-turns/{assemblyRunId}`, so the surface keeps one rendering rather than two. ([validated by `FullTranscriptPanel.test.tsx@cd6b3dbf`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L105), [`FullTranscriptPanel.test.tsx@9598ae43`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L116), [`FullTranscriptPanel.test.tsx@c663b5fb`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L164), [`FullTranscriptPanel.test.tsx@fcd0694e`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L178), [`FullTranscriptPanel.test.tsx@831464e7`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L206), [`FullTranscriptPanel.test.tsx@58ca8bbf`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L435), [`FullTranscriptPanel.test.tsx@ba08b400`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L462), [`FullTranscriptPanel.test.tsx@9a4b9a3f`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L496), [`turn-transcript-presenter.test.ts@a0df896e`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L101), [`turn-transcript-presenter.test.ts@b57120a6`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L195), [`turn-transcript-presenter.test.ts@6b6c21e0`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L218), [`turn-transcript-presenter.test.ts@34e69606`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L235), [`turn-transcript-presenter.test.ts@93022351`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L246), [`turn-transcript-presenter.test.ts@06f31a45`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L268), [`turn-transcript-presenter.test.ts@7a786459`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L274), [`turn-transcript-presenter.test.ts@db51e6cd`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L278))
- The full transcript folds a hook's cumulative turns the same way the blob parser does, keeping the last turn's timestamp, so a run's interleaved SessionStart hooks read as one line each instead of one raw envelope per progress turn. ([validated by [`turn-transcript-presenter.test.ts@76493527`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L287), [`turn-transcript-presenter.test.ts@14278ff1`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L304))
- A tool call that runs long reports itself with cumulative `tool_progress` heartbeats — nineteen for one Skill call in the run that reported this — so a call's beats fold on its `parent_tool_use_id` (each beat's own `tool_use_id` is a fresh `<parent>-heartbeat-<n>`, which would fold nothing) and read as one `· <tool> still running… (<elapsed>)` line carrying the newest total, in the blob viewers and the full transcript alike, rather than one raw envelope per beat, and a beat that reports no clock at all drops the parenthetical rather than claiming the call has run for zero seconds. ([validated by [`agent-log-entries.test.ts@db62245c`](apps/web-ui/src/lib/agent-log-entries.test.ts#L613), [`LogEntriesView.test.tsx@0de6fa39`](apps/web-ui/src/components/LogEntriesView.test.tsx#L282), [`agent-log-entries.test.ts@f2f6a9a6`](apps/web-ui/src/lib/agent-log-entries.test.ts#L576), [`agent-log-entries.test.ts@d572ef5b`](apps/web-ui/src/lib/agent-log-entries.test.ts#L598), [`agent-log-entries.test.ts:585`](apps/web-ui/src/lib/agent-log-entries.test.ts#L629), [`LogEntriesView.test.tsx:264`](apps/web-ui/src/components/LogEntriesView.test.tsx#L268), [`turn-transcript-presenter.test.ts@c71edd6d`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L327))
- A node with no stored turns and a failed fetch each get an explicit message, so an empty panel is never ambiguous between "pruned", "never stored", and "broken"; a failed walk retries when the panel is reopened instead of pinning the error until a page reload, showing the loading state rather than the stale error while the retry is in flight. ([validated by `FullTranscriptPanel.test.tsx@bf353f78`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L236), [`FullTranscriptPanel.test.tsx@4e4192d5`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L285), [`FullTranscriptPanel.test.tsx@9c972136`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L296), [`FullTranscriptPanel.test.tsx@ce93944e`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L315))
- A running or queued step with no turns yet says so (`No turns yet: this step is still running or queued`) instead of blaming retention; a finished step, or one whose status the page does not know, keeps the retention message. The agent attempt card hands the transcript the status `running` for an open attempt. *(added 2026-10-11, #2381)* ([validated by says a running or queued step has no turns yet instead of blaming retention @7429a110](apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.test.tsx#L115), [keeps the retention explanation for a finished or unknown step @c167dc42](apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.test.tsx#L129), [says a running or queued node has no turns yet rather than that they were pruned @3eebd5f0](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L249), [keeps the retention explanation for a finished node with no stored turns @79c946b1](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L269), [renders nothing when hidden @892d7768](apps/web-ui/src/app/assembly-runs/[id]/TranscriptView.test.tsx#L144), [hands the transcript the status running for an open attempt @79428d3e](apps/web-ui/src/app/assembly-runs/[id]/AgentAttemptCard.test.tsx#L37), [hands the transcript no status for a finished attempt @4e22eea6](apps/web-ui/src/app/assembly-runs/[id]/AgentAttemptCard.test.tsx#L43))
- The walk survives React Strict Mode's development double mount: the panel marks itself live again on every mount, so the walk started before the simulated unmount still delivers its turns instead of leaving the panel on Loading ([validated by @1610f388](../../apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L608)).
- The panel shows only node-correlated turns by design: correlation is all-or-nothing at write time, so the line-keyed read can never return a node-less row — the rows correlated to nothing are reachable only through FR4's task-keyed route, which the UI does not surface yet. ([validated by `turn-transcript-presenter.test.ts@a0df896e`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L101), [`agent-run-turns.test.ts@a9b8e460`](libs/shared/src/outbound/project/agent-run-turns/agent-run-turns.test.ts#L63))

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
- **A pilot flag** (`LORE_AGENT_TURNS`, off by default, enabled for one
  repo). This is what ADR-042 specified, and it was built and then removed
  before merge. The flag and the 90-day retention were one mechanism:
  pilot on a repo, measure table growth, let the measurement justify the
  horizon. Without the pilot the flag is a switch nobody flips — dead
  code that also leaves the shipping configuration untested, since every
  flag-off test asserts a state production never runs in. Removing it
  costs the ability to disable collection without a deploy, and buys a
  30-day horizon chosen conservatively instead of a 90-day one resting on
  a measurement that was never going to happen.
- **Do nothing.** The gap is the platform's weakest observability flank
  and the blocker for two follow-ups already sketched: full-fidelity node
  context carryover, and turn-level replay tooling.

## Consequences

- One migration plus a widened tee in an existing route: no new service,
  no new ingress, no new credential surface. That absence of new
  operational surface is the decisive difference from the CxDB draft.
- The real cost moves to `lore-db` storage. Full-fidelity JSONB turns grow
  faster than the truncated projection; the 30-day prune and the per-POST
  cap bound it, and content-addressed dedup of repeated blobs stays the
  escape hatch if growth demands one. Nobody knows the real growth rate:
  dropping the pilot dropped the measurement that was supposed to justify
  the horizon, which is exactly why the horizon starts low.
- **Peak request memory rises on every POST, unconditionally, from the
  first deploy.** This is the main risk being accepted. The collector adds
  no parse and no copy — turns hold slices of the body the scanner already
  produced — but the adapter serializes the whole batch once
  (`JSON.stringify`, re-escaping every envelope byte) and the driver
  encodes that parameter for the wire. A worst-case 8 MB POST therefore
  holds the body plus roughly one to two further copies of it, on the
  order of 20-25 MB transiently, against ~8 MB before this feature. The
  Floor is a single replica requesting 512Mi with a 1Gi limit, and it has
  OOM-crash-looped twice on body-proportional allocations on this exact
  route (2026-07-21, 2026-07-24). The `MAX_VIZ_BODY_BYTES` gate and the
  10 000-turn cap bound the worst case, and this is a different class from
  the unbounded double-parse that caused those incidents — but there is no
  flag to turn it off if it bites, and the replica's memory is worth
  watching after the first deploy.
- The two drop counters are the primary safety net, not a nicety. An
  always-on write on a route with an OOM history needs to be observable
  without anyone opting in: `turn_dropped_redaction` and
  `turn_dropped_cap`, each with a warn line, are what make a store that
  quietly stopped being complete visible. With no pilot and no growth
  measurement, they and the prune's log line are the whole observability
  surface this feature ships with.
- Debugging economics change: full-fidelity, correlated, cursor-paged turn
  history in SQL — the same access idiom as every other Floor
  investigation, with no new query surface to learn.
- Redaction becomes more load-bearing. A queryable store raises the stakes
  of a redaction miss from "buried in GCS" to "searchable", which is why
  the redaction step is specified as a tested control on the write path
  rather than a courtesy.
- Nothing read the store at first. *(Superseded by the #1148 follow-up:)*
  the run detail page's full-transcript panel (FR5) is now the consumer,
  and the task-keyed route (FR4) reaches the uncorrelated rows.

## Out of Scope

- The turn-view UI on the run detail page. The first cut stopped at the
  read API. *(Superseded by the #1148 follow-up:)* delivered as FR5.
- Retiring or shortening the GCS raw archive was out of scope here, with the
  archive framed as the post-prune fallback that made a conservative 30-day
  horizon a safe bet. *(Superseded 2026-08-11, #1148:)* the archive is retired —
  this store is the sole raw record, and turns pruned past the 30-day horizon
  are gone. The accepted answer to "we needed it longer" is extending this
  table's retention, one knob on one store, not resurrecting a second copy.
- Content-addressed dedup of repeated blobs, and any storage-side
  compression beyond what Postgres TOAST does for free.
- Wiring full-fidelity node context carryover or turn-level forking to the
  store. Both are named as motivation, neither is built here.
- A `lore_ui` read path or web-ui proxy. The migration grants `SELECT` so
  the UI follow-up needs no schema change, but no UI code was added in the
  first cut. *(Superseded by the #1148 follow-up:)* the web-ui proxy exists
  (FR5) — and it proxies the Floor API rather than using the grant, matching
  the events flow.

## Amendment — turn coverage per execution path (2026-08-18, #1296)

The GCS task-log cutover (#1148) assumed the store covers every execution
whose logs users read. Audited per path, it does not, and the gaps are
deliberate answers rather than shims:

| Execution path | Turn rows | Notes |
|---|---|---|
| Agent nodes on an assembly line (implementation, review, general, feature-planning, …) | full stream-json transcript | correlated to `assembly_line_id`/`node_id`/`iteration` |
| Plain Agent CR on a non-dark-factory repo (`agent-<taskId8>`) | full transcript, `task_id` only | readable via `listByTask` and the task-keyed HTTP route (#1150, landed) |
| Station pods (validate, gate, detect, github_action, ingest, issues, retrospective) | 2–6 `log`/`result` lines | not a Claude Code transcript; `log` lines exist only here (the viz projection drops them) |
| `onboard`, `feature-request` (direct Anthropic SDK in the Floor process) | none | no transcript artifact exists anywhere; cost lands in `pipeline.llm_calls`, a summary in `memory.episodes` |
| Floor-side batch LLM calls (episode-writer, artifact-copy, memory-lifecycle) | none | same no-transcript property |
| Human stations (`feature_review`, `pr_review`) | none | nothing executes — correct |
| Local runner / `AgentRunner` local mode (deleted 2026-11-13) | full transcript via the task-turns relay (#1295, landed in #1312) | `task_id`-only correlation like row 2; re-POSTed buffers dedup via `dedup_key` (#1389) — turns only, `llm_calls`/`agent_run_events` still duplicate (#1394) |

The reader-side answer for the no-transcript paths is explicit, not
synthetic: no ingest shim fabricates turn rows that would duplicate
`pipeline.llm_calls` and the episode summary. *(Amended 2026-11-13:)* the
task-page log viewer that stated "No transcript is available on this
page." went with the task page on 2026-10-05. A task id now redirects to
its newest run, where a step with no stored turns gets FR5's explicit
empty message, and a task nothing ran for renders `TaskWithoutRun`
("This task has no run"). Residual cutover dependency: task-only turns (row 2)
were HTTP-unreachable until #1150's task-keyed route landed; that
dependency is satisfied, and the remaining write-side gap before #1148
may delete the GCS path is the local runner (#1295).
