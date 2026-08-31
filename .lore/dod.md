# Definition of Done

Strategy: parallel-change
Why: The credential selection in `apps/cluster-agent/src/index.ts` is inline (`() => process.env.LORE_INGEST_TOKEN ?? agentToken`), a per-call fallback with no seam to test. The replacement needs a new `selectReporterToken` function that captures the credential at boot time, which is placed beside the existing code until it is green.

Acceptance tests:
  - apps/cluster-agent/src/claim/select-reporter-token.test.ts::"uses LORE_INGEST_TOKEN captured at boot on a central cluster, not read per call" — central cluster uses the ingest token captured at construction, not a live env read
  - apps/cluster-agent/src/claim/select-reporter-token.test.ts::"returns the agentToken thunk unchanged on a satellite, so rotations are still picked up" — satellite uses the agentToken thunk directly, so per-call rotation still works
  - apps/cluster-agent/src/claim/select-reporter-token.test.ts::"does not pick up LORE_INGEST_TOKEN that appears in the env after the satellite's token is selected" — the KEY invariant: boot-time selection, not a per-call fallback

Facets (the red-green-refactor steps you expect, smallest first):
  - Create `apps/cluster-agent/src/claim/select-reporter-token.ts` exporting `selectReporterToken(env, getAgentToken)` that captures `env.LORE_INGEST_TOKEN` at call time and returns either a static closure (central) or the thunk directly (satellite)
  - Make the three tests green
  - Replace the inline `() => process.env.LORE_INGEST_TOKEN ?? agentToken` in `apps/cluster-agent/src/index.ts` (lines ~95 and ~103) with a call to `selectReporterToken(process.env, () => agentToken)` — one credential, no fallback chain
  - Apply the same replacement to the TelemetrySink credential on line ~103
  - Verify no coverage regression in `vitest run --coverage`

Out of scope:
  - The `acceptedTokens` relay route (line ~127 of index.ts) — that accepts BOTH because run pods may present either; FR8.1 not this ticket
  - Changing the event-router or lore-api auth — FR5 server side is already green
  - The chart-level assertion (check-cluster-agent-standalone-render.sh already guards this)
