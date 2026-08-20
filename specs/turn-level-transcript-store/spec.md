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
`apps/floor/src/delivery/http/routes/agent-events.ts` maps each stream-json
line through `apps/floor/src/jobs/agent/agent-run-events.ts`, whose
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
(`apps/floor/src/delivery/http/routes/agent-logs.ts`) serves an agent's
stdout live from the pod (`KubePodLogs`) and falls back to the Cloud
Logging archive (`CloudLoggingPodLogs` in
`apps/floor/src/jobs/station/agent-pod-logs.ts`) after the pod is
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
- The turn-view UI was **out of scope** for the first cut, which stopped at the read API. *(Superseded by the #1148 follow-up:)* the run detail page now renders turns behind a collapsed full-transcript panel (FR5), and the task-keyed read route exists (FR4).
- The write is live from the first deploy. There is no flag and no pilot, so the projection and the SSE live view continuing to work byte-for-byte is a property that has to be tested rather than a state an operator can restore by flipping something off. (This originally listed the GCS archive too; it was retired the same day, #1148.)

## FR1 — The `pipeline.agent_run_turns` table

Migration `0037_agent_run_turns.sql` under
`infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/`
adds the table, applied by the same `pre-install,pre-upgrade` Helm hook as
every other migration.

- The table stores one row per stream-json line with the **untruncated** envelope in a JSONB column, alongside the same correlation columns `agent_run_events` carries: `task_id`, `agent_cr_name`, `assembly_line_id`, `node_id`, `iteration`, plus the raw line kind in `event_type`. ([validated by `agent-run-turns.test.ts:107`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L138), [`agent-run-turns.test.ts:313`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L373))
- `id` is a `BIGINT GENERATED ALWAYS AS IDENTITY` primary key that doubles as the read cursor, so it is carried as a string-encoded bigint across every boundary and never narrowed to a JS number. ([validated by `agent-run-turns.test.ts:130`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L162), [`agent-run-turns.test.ts:313`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L373))
- The table carries **no foreign keys**, on `task_id` and `assembly_line_id` alike: ingest is a batch insert and one bad row under a FK would abort the whole statement and drop the batch.
- `task_id` is nullable, unlike the projection's `NOT NULL` column, so a line the subsystem never attributed to a task is still stored rather than dropped. ([validated by `agent-run-turns.test.ts:97`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L128))
- Retention is 30 days, longer than the projection's 14 because the table exists precisely for questions asked after the live view has moved on, but deliberately conservative: there is no pilot, so no growth measurement justifies a longer horizon yet. The prune runs on the existing `eventsPrune` housekeeping tick and logs its deleted count, which is the only growth signal the feature ships with. ([validated by `cron.test.ts:61`](apps/floor/src/jobs/cron.test.ts#L61), [`cron.test.ts:68`](apps/floor/src/jobs/cron.test.ts#L68), [`agent-run-turns.test.ts:241`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L273), [`agent-run-turns.test.ts:253`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L285))
- *(Amended 2026-08-18, #1296:)* the window is an operator knob: `LORE_AGENT_RUN_TURN_RETENTION_DAYS`, read at prune time, falling back to the 30-day default — with a warning — when set to anything but an integer in 1..3650 (the cap keeps a pathological value from overflowing Postgres's int32 interval days and failing every hourly tick). This is the same lever the GCS task-log bucket has via the `log_retention_days` terraform variable — both default to 30 days, so retiring the bucket loses no retention at defaults (the issue's "the bucket kept logs indefinitely" premise was wrong). A commented entry in `floor-helm/values.yaml` documents the knob. ([validated by `cron.test.ts:85`](apps/floor/src/jobs/cron.test.ts#L85), [`cron.test.ts:93`](apps/floor/src/jobs/cron.test.ts#L93))
- The migration is idempotent: every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, and the `lore_ui` grant is guarded by a role-existence check, so re-running it on a deploy that changed nothing is a no-op.
- Three indexes cover the three access paths: `(assembly_line_id, id)` for the per-line read, `(task_id, id)` for the per-task read that reaches uncorrelated rows, and `(created_at)` for the retention prune.
- *(Amended 2026-08-19, #1389:)* migration `0042_agent_run_turns_dedup.sql` adds a nullable `dedup_key` column and a partial unique index (`WHERE dedup_key IS NOT NULL`) — re-ingest idempotency for the task-turns relay, whose retried POSTs used to duplicate rows. Only the relay stamps keys; every other producer leaves the column NULL and never dedups. This is ingest idempotency for RETRIED lines, not the content-addressed blob dedup the Out of Scope list rejects — that bullet is about storage-side compression of DISTINCT turns, this key names one line's identity at one transcript position. The index build is non-CONCURRENT on a live table (0042's header carries 0031's build-CONCURRENTLY-by-hand escape hatch); live `ON CONFLICT` semantics are proven by the `migrations.yml` fixture rather than the unit suites.

## FR2 — The `AgentRunTurnsRepository` port

`libs/shared/src/project/agent-run-turns/agent-run-turns-{port,pg,memory}.ts`
mirrors the sibling `agent-run-events/` triple: one port interface, a
Postgres adapter, an in-memory double that is the behavioral spec, and one
colocated test suite exercising both.

- `insertBatch` resolves `agentCrName` to (`assemblyLineId`, `nodeId`, `iteration`) against `pipeline.assembly_line_nodes` at write time, taking the newest matching node row when two lines collide on a CR name. ([validated by `agent-run-turns.test.ts:38`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L38), [`agent-run-turns.test.ts:273`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L305))
- A row whose `agentCrName` matches no node row is still inserted, with `agentCrName` retained and the three correlated fields left null — skip-not-fail, because ingest must never lose a batch. ([validated by `agent-run-turns.test.ts:63`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L93))
- One uncorrelated row never suppresses the rest of its batch: the remaining rows insert normally. ([validated by `agent-run-turns.test.ts:78`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L109))
- `insertBatch` returns the persisted rows ascending by id, comparing ids numerically rather than lexicographically so a bigint cursor cannot page backwards past 10 digits. Both adapters share one comparator, and it is a total order — equal ids compare equal, never "greater". ([validated by `agent-run-turns.test.ts:208`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L240), [`agent-run-turns.test.ts:313`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L373), [`agent-run-turns.test.ts:410`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L471), [`agent-run-turns.test.ts:414`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L475), [`agent-run-turns.test.ts:420`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L481), [`agent-run-turns.test.ts:426`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L487))
- The batch crosses to Postgres as a **single bound `jsonb` parameter** expanded by `jsonb_to_recordset`, never a string-built `VALUES` list: turn envelopes carry agent-controlled text that must never reach statement text. ([validated by `agent-run-turns.test.ts:285`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L340))
- The envelope crosses the port as JSON **text** and is cast to `jsonb` inside the statement, so the ingest path never re-parses a payload it is already holding as a string; the one serialization left is the adapter's single `JSON.stringify` of the whole batch at the Postgres boundary. ([validated by `agent-run-turns.test.ts:304`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L364))
- An empty batch issues no query at all and returns an empty array. ([validated by `agent-run-turns.test.ts:142`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L174), [`agent-run-turns.test.ts:266`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L298))
- `listByLine` returns one assembly line's turns ascending by id, above a cursor and capped by a limit, so a reader pages a finished run without gaps or duplicates. ([validated by `agent-run-turns.test.ts:175`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L207), [`agent-run-turns.test.ts:183`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L215), [`agent-run-turns.test.ts:195`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L227), [`agent-run-turns.test.ts:360`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L420))
- `listByTask` reads the same way scoped to a task id. It has no production caller today and is kept deliberately: it is the ONLY path that can reach the uncorrelated rows FR1 requires the table to preserve, and a store that keeps rows nothing can ever read would contradict its own reason for keeping them. Delete it only together with the decision to stop storing uncorrelated turns. ([validated by `agent-run-turns.test.ts:226`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L258), [`agent-run-turns.test.ts:372`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L432))
- `pruneOld` deletes rows older than a day horizon and returns the count deleted. ([validated by `agent-run-turns.test.ts:241`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L273), [`agent-run-turns.test.ts:383`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L443))
- *(Amended 2026-08-19, #1389:)* `AgentRunTurnInsert` carries an optional `dedupKey`. A non-null key already stored skips its row — silently, never a batch failure — and `insertBatch` returns only the rows the call actually inserted; a null key never dedups, and pruning a row frees its key. The Pg adapter uses a BARE `ON CONFLICT DO NOTHING`, deliberately naming no arbiter target: naming the partial index would `42P10`-fail every insert against a database missing it, degrading "duplicates" into total turn loss. ([validated by `agent-run-turns.test.ts:498`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L498), [`agent-run-turns.test.ts:510`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L510), [`agent-run-turns.test.ts:522`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L522), [`agent-run-turns.test.ts:531`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L531), [`agent-run-turns.test.ts:546`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L546), [`agent-run-turns.test.ts:559`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L559))

## FR3 — The ingest tee

The collector lives at `apps/floor/src/jobs/agent/agent-run-turns.ts` and
is driven from the **existing single pass** in `parseAgentSink`
(`apps/floor/src/jobs/agent/agent-events.ts`), the same loop that already
produces the cost rows and the projection rows.

- Turn collection is unconditional: every `/api/agent-events` POST collects turns, with no feature flag and nothing for an operator to switch on. ([validated by `agent-sink-turns.test.ts:21`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L21), [`agent-events-turns.test.ts:54`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L54))
- Collecting turns perturbs nothing else. The cost rows and the run-visualization rows are byte-for-byte what they would be without the turn store, so the projection and the SSE view are unaffected. With no off switch in production this property is the only thing standing between the store and a regression in the outputs that were already there. ([validated by `agent-sink-turns.test.ts:33`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L33), [`agent-sink-turns.test.ts:25`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L25), [`agent-events-turns.test.ts:68`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L70))
- A turn is built from the envelope the single pass **already parsed** — the collector re-parses nothing and re-serializes nothing, taking the raw line the scanner already yielded as the stored envelope. ([validated by `agent-run-turns.test.ts:16`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L18), [`agent-run-turns.test.ts:29`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L63), [`agent-run-turns.test.ts:36`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L70), [`agent-sink-turns.test.ts:41`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L41), [`agent-sink-turns.test.ts:51`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L51))
- The stored envelope is redacted with the same `redactSecrets` the GCS archive used, before it ever reaches the database, because a queryable store raises a redaction miss from "buried in GCS" to "searchable". ([validated by `agent-run-turns.test.ts:46`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L80))
- Redaction is verified not to have broken the line's JSON: an unchanged line is kept as-is, and a redacted line that no longer parses is dropped rather than risking a batch-wide insert failure. ([validated by `agent-run-turns.test.ts:29`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L63), [`agent-run-turns.test.ts:58`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L92))
- A dropped turn is counted and warned about, never silent. The private-key pattern is not anchored inside one JSON string, so an agent can emit a `BEGIN`/`END` pair straddling JSON structure and thereby keep its own line out of the transcript; a store justified by fidelity has to make that loss visible. ([validated by `agent-sink-turns.test.ts:90`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L90), [`agent-sink-turns.test.ts:97`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L97), [`agent-sink-turns.test.ts:106`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L106), [`agent-sink-turns.test.ts:110`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L110), [`agent-events-turns.test.ts:108`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L110), [`agent-events-turns.test.ts:126`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L128))
- Turns left out by the per-batch cap are counted and warned about too, separately from the redaction drops. With both paths counted, every way the sink can lose a turn is visible, which is what lets "this transcript is complete" be read off the metrics instead of assumed. ([validated by `agent-sink-turns.test.ts:123`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L123), [`agent-sink-turns.test.ts:130`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L130), [`agent-sink-turns.test.ts:134`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L134), [`agent-sink-turns.test.ts:138`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L138), [`agent-events-turns.test.ts:140`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L142))
- A line the subsystem attributed to no task, or of a kind this Floor has never seen, is still collected — carrying a null task id or a null kind, matching the table's nullable columns. ([validated by `agent-run-turns.test.ts:66`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L100), [`agent-run-turns.test.ts:75`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L109), [`agent-sink-turns.test.ts:57`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L57))
- Collection is capped per POST at the same order as the projection's cap, so a pathological multi-megabyte report cannot materialize an unbounded row set on the single Floor replica. ([validated by `agent-run-turns.test.ts:83`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L117), [`agent-sink-turns.test.ts:64`](apps/floor/src/jobs/agent/agent-sink-turns.test.ts#L64))
- Turn collection is skipped entirely for an oversized body, reusing the projection's existing `MAX_VIZ_BODY_BYTES` gate rather than adding a second size rule. ([validated by `agent-events-turns.test.ts:87`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L89))
- A failure to persist turns is counted and logged, never propagated: cost accounting is the sink's contract and a non-authoritative store must not be able to fail it. ([validated by `agent-events-turns.test.ts:77`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L79), [`agent-events-turns.test.ts:54`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L54))
- *(Amended 2026-08-19, #1389:)* a turn skipped as an already-stored duplicate (its `dedupKey` matched an existing row) is counted (`turn_deduped`) and warned like the two dropped-turn paths: expected on a relay retry, but the only path that could ever swallow a legitimate line, so it must be visible. The relay's collector reads the key from the envelope's `source.turn_key`; pod envelopes carry none. ([validated by `agent-run-turns.test.ts:123`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L123), [`agent-run-turns.test.ts:134`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L134), [`agent-run-turns.test.ts:142`](apps/floor/src/jobs/agent/agent-run-turns.test.ts#L142), [`agent-events-turns.test.ts:164`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L164), [`agent-events-turns.test.ts:180`](apps/floor/src/delivery/http/routes/agent-events-turns.test.ts#L180))

Since issue #1295 the sink has a second producer besides the ai-agent-subsystem
pods: the mcp-server local runner relays its redacted stream-json transcript
through lore-api's `POST /api/task-turns/{taskId}`
(`specs/api-routes/task-turns/spec.md`), which wraps each line in the task
attribution envelope and forwards it to this same ingest. Those turns carry a
task id but no agent CR name, so they land uncorrelated to any assembly line —
the rows FR1 preserves and `listByTask` exists to reach.

## FR4 — The read API

`GET /api/agent-turns/{assemblyLineId}` on the Floor HTTP server mirrors
the existing `GET /api/agent-events/{assemblyLineId}` history route.

- The route hands back one assembly line's turns with their envelopes untruncated, behind the same `ingest-token` bearer auth every other Floor read carries. ([validated by `agent-turns-history.test.ts:55`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L55), [`agent-turns-history.test.ts:100`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L100))
- The route reads through `listByLine`, scoping rows by line **and** cursor rather than by cursor alone. ([validated by `agent-turns-history.test.ts:65`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L65))
- The limit is clamped to a maximum and falls back to a default for a missing, non-numeric, zero or negative value, because the token is shared with the web-ui and an unbounded limit would be an unbounded read; the route reads one lookahead row past the clamped limit to answer `hasMore`. ([validated by `agent-turns-history.test.ts:78`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L78))
- The response carries an explicit `hasMore` flag — true only when a row exists past the returned page, with the lookahead row withheld, and always present including on an empty page — so the web-ui walks end on the server's answer instead of comparing page length against a client-side copy of the clamp (#1310). ([validated by `agent-turns-history.test.ts:115`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L115), [`agent-turns-history.test.ts:127`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L127), [`agent-turns-history.test.ts:139`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L139))
- The cursor falls back to `0` for anything that is not a run of digits, so a malformed `after` reads the run from its start instead of erroring. ([validated by `agent-turns-history.test.ts:91`](apps/floor/src/delivery/http/routes/agent-turns-history.test.ts#L91))

`GET /api/agent-turns/task/{taskId}` is the task-keyed sibling (a #1148
follow-up), reading through `listByTask` — the only path to the
uncorrelated rows FR1 requires the table to preserve, which were otherwise
stored but unreachable over HTTP.

- The task route hands back one task's turns — including rows correlated to no assembly line — behind the same `ingest-token` bearer auth. ([validated by `agent-turns-by-task.test.ts:56`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L56), [`agent-turns-by-task.test.ts:104`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L104))
- It reads through `listByTask`, scoping rows by task **and** cursor, and its literal `task` path segment never collides with the registered line route sharing the `/api/agent-turns` prefix. ([validated by `agent-turns-by-task.test.ts:69`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L69), [`agent-turns-by-task.test.ts:117`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L117))
- The limit clamp, default, lookahead and `hasMore` flag are byte-identical to the line route's, for the same shared-token reason. ([validated by `agent-turns-by-task.test.ts:82`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L82), [`agent-turns-by-task.test.ts:136`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L136), [`agent-turns-by-task.test.ts:155`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L155))
- The cursor falls back to `0` for a malformed `after`, same as the line route. ([validated by `agent-turns-by-task.test.ts:95`](apps/floor/src/delivery/http/routes/agent-turns-by-task.test.ts#L95))

## FR5 — The turn-view UI

The run detail page (`apps/web-ui/src/app/assembly-runs/[id]/`) surfaces
the store through a session-authed proxy plus a collapsed
`FullTranscriptPanel` next to the selected node's live transcript — the
truncated live view stays the page's default and pays nothing for the
panel's existence (the #1148 follow-up; deliberately one reused panel, not
a parallel page, per #1102).

- `GET /api/assembly-runs/[id]/turns` proxies the Floor's line-keyed turns route with the same auth ladder as the sibling events proxy: session (401) → run lookup (404) → repo access (403) → env guard (500). ([validated by `route.test.ts:47`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L47), [`route.test.ts:56`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L56), [`route.test.ts:65`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L65), [`route.test.ts:76`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L76))
- The proxy forwards `after`/`limit` untouched, sends `LORE_INGEST_TOKEN` as the bearer, propagates the request's abort signal, returns the Floor's status and body verbatim, and opts out of route caching. ([validated by `route.test.ts:42`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L42), [`route.test.ts:87`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L87), [`route.test.ts:97`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L97), [`route.test.ts:107`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L107), [`route.test.ts:118`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L118), [`route.test.ts:126`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L126), [`route.test.ts:135`](apps/web-ui/src/app/api/assembly-runs/[id]/turns/route.test.ts#L135))
- The row crosses into the web-ui as a hand-mirrored `AgentRunTurn` (web-ui cannot import `@re-cinq/lore-shared`), guarded keys-only by `scripts/type-drift/run-turn-types.drift.ts`; the parser requires the identity fields, keeps every correlation field nullable, keeps unknown event kinds unnarrowed, and never throws. ([validated by `run-turn-types.test.ts:21`](apps/web-ui/src/lib/run-turn-types.test.ts#L21), [`run-turn-types.test.ts:25`](apps/web-ui/src/lib/run-turn-types.test.ts#L25), [`run-turn-types.test.ts:39`](apps/web-ui/src/lib/run-turn-types.test.ts#L39), [`run-turn-types.test.ts:47`](apps/web-ui/src/lib/run-turn-types.test.ts#L47), [`run-turn-types.test.ts:51`](apps/web-ui/src/lib/run-turn-types.test.ts#L51), [`run-turn-types.test.ts:55`](apps/web-ui/src/lib/run-turn-types.test.ts#L55), [`run-turn-types.test.ts:59`](apps/web-ui/src/lib/run-turn-types.test.ts#L59))
- The panel renders collapsed and fetches nothing until first opened, so the default view is unaffected; reopening it while the first walk is still in flight never starts a second one, and the mount is keyed on the run id so run navigation cannot leak a stale transcript. The page URL and cursor arithmetic are pure presenter functions. ([validated by `FullTranscriptPanel.test.tsx:72`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L72), [`FullTranscriptPanel.test.tsx:168`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L168), [`turn-transcript-presenter.test.ts:38`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L38), [`turn-transcript-presenter.test.ts:44`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L44), [`turn-transcript-presenter.test.ts:50`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L50))
- Once opened it pages the proxy with the cursor, ending the walk on the response's explicit `hasMore` flag when it is a boolean and falling back to the pre-#1310 short-page rule when the flag is absent (an older Floor during deploy skew), reading the cursor off the raw page so one unparseable row cannot end the paging early — and a `hasMore: true` page with no usable cursor still ends the walk — showing the cap notice, since the one-shot walk never retries — rather than refetching itself forever. ([validated by `FullTranscriptPanel.test.tsx:92`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L92), [`FullTranscriptPanel.test.tsx:271`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L271), [`FullTranscriptPanel.test.tsx:292`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L292), [`FullTranscriptPanel.test.tsx:305`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L305), [`FullTranscriptPanel.test.tsx:338`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L338), [`turn-transcript-presenter.test.ts:66`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L66), [`turn-transcript-presenter.test.ts:70`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L70), [`turn-transcript-presenter.test.ts:74`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L74), [`turn-transcript-presenter.test.ts:78`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L78), [`turn-transcript-presenter.test.ts:120`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L120), [`turn-transcript-presenter.test.ts:124`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L124), [`turn-transcript-presenter.test.ts:128`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L128), [`turn-transcript-presenter.test.ts:132`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L132), [`turn-transcript-presenter.test.ts:145`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L145), [`turn-transcript-presenter.test.ts:150`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L150), [`turn-transcript-presenter.test.ts:154`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L154), [`turn-transcript-presenter.test.ts:162`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L162), [`turn-transcript-presenter.test.ts:167`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L167))
- The walk is bounded, never silent about it: it requests the Floor route's maximum page size rather than its default, stops at a hard turn cap or at a per-walk page bound (so a Floor clamp far below the requested page size costs bounded requests, not a storm), and shows a notice carrying the actual loaded count instead of materializing an unbounded run in the tab. ([validated by `FullTranscriptPanel.test.tsx:109`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L109), [`FullTranscriptPanel.test.tsx:321`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L321), [`turn-transcript-presenter.test.ts:58`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L58), [`turn-transcript-presenter.test.ts:62`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L62), [`turn-transcript-presenter.test.ts:139`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L139))
- It renders the selected node's turns with their **untruncated** envelopes, labeled by the raw stream-json kind and the iteration; switching the selected node refilters the one line-scoped fetch instead of refetching. ([validated by `FullTranscriptPanel.test.tsx:81`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L81), [`FullTranscriptPanel.test.tsx:128`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L128), [`FullTranscriptPanel.test.tsx:142`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L142), [`FullTranscriptPanel.test.tsx:153`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L153), [`turn-transcript-presenter.test.ts:88`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L88), [`turn-transcript-presenter.test.ts:100`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L100), [`turn-transcript-presenter.test.ts:104`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L104), [`turn-transcript-presenter.test.ts:112`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L112))
- A node with no stored turns and a failed fetch each get an explicit message, so an empty panel is never ambiguous between "pruned", "never stored", and "broken"; a failed walk retries when the panel is reopened instead of pinning the error until a page reload, showing the loading state rather than the stale error while the retry is in flight. ([validated by `FullTranscriptPanel.test.tsx:188`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L188), [`FullTranscriptPanel.test.tsx:201`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L201), [`FullTranscriptPanel.test.tsx:212`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L212), [`FullTranscriptPanel.test.tsx:231`](apps/web-ui/src/app/assembly-runs/[id]/FullTranscriptPanel.test.tsx#L231))
- The panel shows only node-correlated turns by design: correlation is all-or-nothing at write time, so the line-keyed read can never return a node-less row — the rows correlated to nothing are reachable only through FR4's task-keyed route, which the UI does not surface yet. ([validated by `turn-transcript-presenter.test.ts:88`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L88), [`agent-run-turns.test.ts:63`](libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts#L63))

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
| Station pods (validate, gate, detect, github_action, comment-triage, ingest, issues, retrospective) | 2–6 `log`/`result` lines | not a Claude Code transcript; `log` lines exist only here (the viz projection drops them) |
| `onboard`, `feature-request` (direct Anthropic SDK in the Floor process) | none | no transcript artifact exists anywhere; cost lands in `pipeline.llm_calls`, a summary in `memory.episodes` |
| Floor-side batch LLM calls (episode-writer, artifact-copy, memory-lifecycle) | none | same no-transcript property |
| Human stations (`feature_review`, `pr_review`) | none | nothing executes — correct |
| Local runner / `AgentRunner` local mode | full transcript via the task-turns relay (#1295, landed in #1312) | `task_id`-only correlation like row 2; re-POSTed buffers dedup via `dedup_key` (#1389) — turns only, `llm_calls`/`agent_run_events` still duplicate (#1394) |

The reader-side answer for the no-transcript paths is explicit, not
synthetic: the task-page log viewer states "No transcript is available
on this page." once a task is past running with no logs (see
`specs/job-log-streaming/spec.md`), instead of an ingest shim
fabricating turn rows that would duplicate `pipeline.llm_calls` and the
episode summary. Residual cutover dependency: task-only turns (row 2)
were HTTP-unreachable until #1150's task-keyed route landed; that
dependency is satisfied, and the remaining write-side gap before #1148
may delete the GCS path is the local runner (#1295).
