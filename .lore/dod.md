# Definition of Done

> "Agent telemetry stores GitHub tokens unredacted (agent_run_events / agent_run_turns)"

**Strategy: `direct`** — `redactSecrets()` in `libs/shared/src/lib/redact.ts` is the real entry point for all agent-telemetry writes. The turn store (`POST /api/task-turns/{taskId}`) already pipes every line through `redactJsonLine` → `redactSecrets`; the gap is that the base64 basic-auth form `Authorization: Basic base64("x-access-token:ghs_…")` is only ~68 characters — below the 100-char floor of the generic `base64-blob` pattern — so it slips through every existing rule.

## Done when these pass

- [x] **redacts the base64 basic-auth encoding of an x-access-token credential** — `redactSecrets()` must strip `Authorization: Basic <base64(x-access-token:ghs_…)>` before the string reaches any store
  `libs/shared/src/lib/redact-secret-patterns.test.ts`

## Facets

- [x] Add a pattern to `PATTERNS` in `libs/shared/src/lib/redact.ts` that recognises the base64-encoded `x-access-token:…` basic-auth blob (a dedicated decode-and-match or a character-class pattern anchored after `Basic `)
- [x] Confirm the existing 23 pattern tests still pass after the addition

## Out of scope

- Scrubbing the 27 historical `agent_run_events` rows and 11 `agent_run_turns` rows (the ticket flags this as optional; the tokens in those rows are expired installation tokens)
- The `agent_run_events` write path — the old Floor's `/api/agent-events` route was deleted on 2026-10-02; all new transcript writes go through `task-turns.ts`, which already calls `redactSecrets`
- The plain-text `ghs_…` form — already caught by the `api-key` pattern (`ghs_` prefix)
- The plain-text URL form `x-access-token:ghs_…@github.com` — already caught by the `github-token` pattern
