# Tasks: Move lore-api request validation into hapi's `options.validate` (zod)

**Status: Draft.** Follows ADR-033's end state (lore-api is pure hapi) by wiring
zod schemas into hapi's validation lifecycle. Each route-group phase is **one
commit**: add the schemas + `validate` options, delete that group's `parse:false`
+ in-handler parsing, migrate its tests — together. The suite stays green after
every phase.

Legend: `[P]` = parallelizable with siblings in the same phase.

## Phase 0 — Foundation (ADR + validator)

- [x] T001 Write `adrs/ADR-034-lore-api-request-validation.md` (MADR, amends
  ADR-033): context (hand-rolled body parse + imperative field checks, `parse:false`
  purely to mimic the legacy `500`-on-bad-JSON), decision (zod → hapi
  `options.validate` via a shared adapter; `{ error }` 400 body; hapi parses
  payloads so **malformed JSON becomes `400`, not `500`**), consequences,
  alternatives (joi / keep-500 half-refactor / status quo).
- [x] T002 `apps/lore-api/src/server/plugins/zod-validate.ts`: `zodValidate(schema)`
  → an async hapi validation function (`safeParse`, throw a Boom whose
  `output.payload` is pre-shaped to `{ error: <message> }` — the `bearer-scope.ts`
  pattern). `formatZodError(err)` renders a single message naming the first
  offending field. `zod-validate.test.ts`: valid → returns typed data; invalid →
  Boom 400 with `{ error }`; field name present. (FR1, FR3)

## Phase 1 — Memory group

- [x] T003 `routes/memory/*`: schemas `WriteMemoryBody`/`ReadMemoryBody`/... as a
  zod **discriminated union** on `action` (FR6) for `memory.ts`; a flat schema for
  `episode.ts` and `session-summary.ts`. Drop `parse:false`; add
  `validate: { payload: zodValidate(...) }`; handlers read typed `request.payload`
  (no `rawBody`/`JSON.parse`). Preserve the DB-vs-file fallbacks and the
  session-summary short-summary-skip ordering. Tests migrated: the per-action 400s
  become schema 400s; **the `memory.test.ts` invalid-JSON case flips `500 → 400`
  (ADR-034)**. (FR2, FR4, SC-2, SC-3)

## Phase 2 — Tasks group

- [x] T004 `routes/tasks/task-post.ts`: model the create/retry/cancel/set-priority/
  status-update variants as a zod discriminated union (or a permissive base schema
  + documented residual branching if the variants are too irregular — FR6). Drop
  `parse:false`; `validate` the payload; keep the `503`-no-pool guard and the
  `getTaskTypes()` fallback-to-`general`. **`task-post.test.ts` invalid-JSON flips
  `500 → 400`.** `routes/tasks/task-logs.ts` (POST) converted the same way. (FR2,
  FR4, SC-2, SC-3)

## Phase 3 — Ingest group

- [x] T005 [P] `routes/ingest/ingest.ts` + `routes/ingest/ingest-graph.ts`: payload
  schemas (ingest-graph: `{ kinds[], commit, force? }`, `{owner}/{repo}` already
  typed params); drop `parse:false`; preserve empty-body → `{}` (schema default)
  and the fire-and-forget triggers firing before `return`. Tests migrated. (FR2, FR4)

## Phase 4 — Repos-write + admin group

- [x] T006 `routes/repos/onboard.ts` (payload schema, admin scope unchanged);
  `routes/tokens/tokens.ts` (POST create/revoke union — `name` required, scopes
  enum); `routes/dark-factory/dark-factory.ts` (PUT body schema — the two-key
  ceremony + JSONB txn + audit stay in the handler; only the parse moves);
  `routes/agent-definitions/agents.ts` (POST/PUT/DELETE payload schemas, the
  `image` two-key gate intact). These used `parseJsonBodyCapped` with 2 MB
  `maxBytes` — keep the raised `maxBytes` (now with `parse:true`). Tests migrated.
  (FR2, FR4, FR5, SC-3)

## Phase 5 — Features group

- [ ] T007 `routes/features/features.ts`: hapi parses the payload (`parse:true`,
  keep 2 MB `maxBytes`); handlers read `request.payload` instead of
  `parseJsonBodyCapped`. **Domain transforms stay** — `enforceFeatureInput`,
  `parseSectionAnswers`, `parseGapResult`/`sanitizeGapResult` are validation +
  coercion, not field-presence, so they remain in the handler (fed `request.payload`);
  a thin base object schema guards shape. The `run()` ValidationError→400/else→500
  mapping is preserved. GET `query.status` gains a params/query schema where it
  removes a cast. Tests migrated. (FR2, FR4, FR6)

## Phase 6 — Trace + impact group

- [ ] T008 [P] `routes/impact/impact.ts` (payload schema; the fail-soft `200`
  preserved); `routes/trace/trace.ts` (`{kind}` param schema — the allowlist
  becomes a zod enum → `404`/`400` per current behavior). Tests migrated. (FR2, FR4)

## Phase 7 — Teardown + verify

- [ ] T009 Delete `parseJsonBodyCapped` from `server/raw-body.ts` once no route
  imports it (`rawBody` **stays** — the webhook routes still use it, FR7). Remove
  any now-unused `WRITE_PAYLOAD`/`parse:false` remnants from converted routes.
- [ ] T010 Verify all success criteria:
  - **SC-1** `grep -rE "rawBody|parseJsonBodyCapped|JSON.parse" apps/lore-api/src/api/routes`
    returns nothing outside `routes/webhooks/` + tests.
  - **SC-2** malformed JSON → `400` on memory + task-post (tests cite ADR-034).
  - **SC-3** each converted route: missing/mis-typed required field → `400 { error }`.
  - **SC-4** `rate-limit.test.ts` + `bearer-scope.test.ts` green (401/403 precede
    validation).
  - **SC-5** `tsc --noEmit` clean; full vitest suite green; `npm run build` (monorepo) exits 0.
