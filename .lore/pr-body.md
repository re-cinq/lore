The cluster-agent was choosing which credential to use on every call via
`process.env.LORE_INGEST_TOKEN ?? agentToken`. That per-call fallback is what
caused the 2026-08-24 outage: a central-cluster agent that had `LORE_INGEST_TOKEN`
mounted would correctly pick it up most of the time, but any satellite that
somehow acquired the variable after boot would shadow its own per-agent token
and 401 on every report — both ends typechecked, nothing in the logs until the
reaper cleaned up the stuck nodes.

The fix is in `apps/cluster-agent/src/claim/select-reporter-token.ts`. The
function `selectReporterToken(env, getAgentToken)` reads `env.LORE_INGEST_TOKEN`
exactly once at call time and makes a permanent decision: if the token is
present the central path captures it in a static closure and returns that same
value forever, so later env mutations are irrelevant; if it is absent the
satellite path returns the `getAgentToken` thunk directly, so re-registration
rotations continue to be picked up per call. There is no fallback chain, and
the choice cannot change after boot.

`apps/cluster-agent/src/index.ts` calls `selectReporterToken(process.env, () =>
agentToken)` once during startup and binds the result to `reporterToken`. Both
the `ClaimLoop` reporter and the `TelemetrySink` now receive that single
reference instead of inlining the `??` expression independently. Keeping two
separate inlinings was an additional hazard: they could drift.

The three acceptance tests in
`apps/cluster-agent/src/claim/select-reporter-token.test.ts` cover the three
invariants the DoD names: the central capture survives an env delete after
selection, the satellite thunk reflects rotations made after selection, and a
satellite ignores `LORE_INGEST_TOKEN` that appears in the env after the choice
was made. All three were written red first, then made green by the implementation.

This is FR5 of `specs/running-stations-in-any-k8s-cluster/spec.md`. The
`acceptedTokens` relay route in `index.ts` (line 120) was deliberately left
unchanged — it accepts both tokens because agent run pods may present either,
and that multi-token accept path is covered by a separate requirement (FR8.1).

No deviation from the DoD strategy.
