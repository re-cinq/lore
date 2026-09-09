# Definition of Done

> The cluster-agent picks its reporting credential as `LORE_INGEST_TOKEN ?? satelliteToken` in `apps/cluster-agent/src/index.ts` — the central path presents the bus-wide token, a satellite presents the per-agent token it received at registration. That fork is no longer necessary. … always report with the per-agent token, once registration has completed. Keep `LORE_INGEST_TOKEN` only as the boot-window fallback.

**Strategy: `direct`** — `selectReporterToken` (`apps/cluster-agent/src/claim/select-reporter-token.ts`) is the seam: it already accepts both `env` and a `getAgentToken` thunk. The acceptance test calls it directly and fails because the function captures `LORE_INGEST_TOKEN` at boot and returns it unconditionally for central clusters, ignoring the per-agent token even after registration completes.

## Done when these pass

- [ ] **switches to the per-agent token on a central cluster once registration completes** — `selectReporterToken` must resolve `agentToken` when it is available, falling back to `LORE_INGEST_TOKEN` only while `agentToken` is `undefined` (the boot window before registration). Verifies acceptance criterion 2: "A central-mode report authenticates against `pipeline.cluster_agents`."
  `apps/cluster-agent/src/claim/select-reporter-token.test.ts`

## Facets

- [x] Change `selectReporterToken`: when `LORE_INGEST_TOKEN` is present, return a thunk that resolves `getAgentToken()` first and falls back to `LORE_INGEST_TOKEN` only when it is `undefined` — mirroring the satellite branch but with the fallback.
- [x] Update the existing test "uses LORE_INGEST_TOKEN captured at boot on a central cluster" to reflect the new semantics (LORE_INGEST_TOKEN is the boot-window fallback, not a permanent override).
- [x] Confirm the other three existing tests still pass after the change.

## Out of scope

- Removing `LORE_INGEST_TOKEN` from the event-router's accepted credentials (the router still validates it for backward compat with non-cluster-agent callers).
- Changing the index.ts wiring — the `onUnauthorized: () => claimLoop.reRegister()` path is already in place for both central and satellite.
- The per-agent token being written to Kubernetes Secrets for run pods (FR8 — separate acceptance path).
