# Tasks: Turn-Level Transcript Store

Spec: [spec.md](./spec.md). Every task is test-first — write the failing
test, confirm it fails for the stated reason, then implement, then commit.
`[P]` marks tasks that touch disjoint files and could run in parallel.

## Phase 1 — Schema

- [x] **T1** Add `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0037_agent_run_turns.sql`: `pipeline.agent_run_turns` with the FR1 columns, three indexes, `lore` grant and role-guarded `lore_ui` SELECT grant. Every statement `IF NOT EXISTS`. No test — the migration is DDL applied by the Helm hook; FR1's behavioral claims are validated through the adapter in T2.

## Phase 2 — The repository port

- [x] **T2** `libs/shared/src/project/agent-run-turns/agent-run-turns.test.ts` (new file): the failing suite for both implementations — correlation to the newest node, uncorrelated rows kept, mixed batches, numeric id ordering, empty batch issues no query, single bound `jsonb` parameter, envelope cast from text, `listByLine` / `listByTask` cursor paging, `pruneOld` horizon.
- [x] **T3** `libs/shared/src/project/agent-run-turns/agent-run-turns-port.ts`: `AgentRunTurnRow`, `AgentRunTurnInsert`, `AgentRunTurnNodeRef`, `AgentRunTurnsRepository`.
- [x] **T4** `libs/shared/src/project/agent-run-turns/agent-run-turns-memory.ts`: `InMemoryAgentRunTurns`, the behavioral spec of the port.
- [x] **T5** `libs/shared/src/project/agent-run-turns/agent-run-turns-pg.ts`: `PgAgentRunTurns` — `jsonb_to_recordset` + `LEFT JOIN LATERAL` correlation, `v.envelope::jsonb` cast.
- [x] **T6** Export the port types and both implementations from `libs/shared/src/project/index.ts`; re-run `scripts/worktree-bootstrap.sh` so `tsc` sees the fresh `dist`.

T2–T6 land as one commit: the test file cannot compile without the port,
and the port is dead code without the test.

## Phase 3 — The ingest tee

- [x] **T7** `apps/floor/src/jobs/agent/agent-run-turns.test.ts` + `agent-run-turns.ts`: `turnFromEnvelope` (redaction, JSON-validity guard, null task id, event kind) and `MAX_RUN_TURNS_PER_BATCH`. A `LORE_AGENT_TURNS` feature flag was built here and removed before merge — collection is unconditional; see the spec's Alternatives rejected.
- [x] **T8** Widen `parseAgentSink` in `apps/floor/src/jobs/agent/agent-events.ts` with a third `turns` output collected in the **existing** loop, gated by a `collectTurns` argument. Tests go in a NEW `apps/floor/src/jobs/agent/agent-sink-turns.test.ts`, not appended to `agent-sink.test.ts`: that file carries `#L` anchors from `specs/assembly-line-run-viz`, and hosting these tests would have meant a mid-file import insert that shifts them.
- [x] **T9** [P] Bind the `agentRunTurns()` lazy singleton in `apps/floor/src/kernel/queues.ts`.
- [x] **T10** Tee the route: `apps/floor/src/delivery/http/routes/agent-events.ts` persists turns skip-not-fail behind the flag and the existing oversized gate, and counts turns dropped by redaction. Tests go in a NEW `apps/floor/src/delivery/http/routes/agent-events-turns.test.ts` — the existing route test's module mock would have had to be widened in place, shifting its anchors.
- [x] **T11** [P] Prune turns at 90 days on the existing `eventsPrune` tick in `apps/floor/src/jobs/cron.ts`; test appended at the end of `apps/floor/src/jobs/cron.test.ts` if one exists, otherwise covered by the port's `pruneOld` suite.

## Phase 4 — The read API

- [x] **T12** `apps/floor/src/delivery/http/routes/agent-turns-history.ts` + colocated test (new files): `GET /api/agent-turns/{assemblyLineId}`, clamped limit and cursor, registered in `apps/floor/src/delivery/http/server.ts`.

## Phase 5 — Supersession

- [x] **T13** Delete `adrs/ADR-042-turn-level-transcript-store.md`; this spec supersedes it.
