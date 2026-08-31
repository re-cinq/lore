# Definition of Done

Strategy: direct

Why: The launch seam already exists in `AgentCrStationBackend.launch()`, which
writes a `queued` station run for any single-CR task type. The reaper's
definition-less arm (the `if (!graph)` branch in `assemblyLineReaperJob`) handles
queue-timeout and offline-requeue for those same rows. Both seams are exercised
by tests that call the production functions end-to-end without mocks.

Acceptance tests:
  - apps/floor/src/jobs/station/agent-cr-station-backend.test.ts::"enqueues a single-CR task as a claimable row instead of pushing a CR" — the launch seam writes `status: "queued"`, not a pushed Agent CR
  - apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts::"fails a single-CR run nobody claimed, naming the tags that went unmatched" — queue-wait timeout on the definition-less arm
  - apps/floor/src/jobs/assembly-run/assembly-run-reaper.test.ts::"requeues a single-CR visit whose claiming cluster went offline" — offline-requeue on the definition-less arm

Facets (smallest first):
  - `AgentCrStationBackend.launch()` writes `status: "queued"` for task types with no assembly-line YAML
  - The `queued` row is claimable via `claimNextStationRun` (any cluster with the right tags)
  - The reaper's definition-less arm (`if (!graph)`) picks up single-CR queue-timeout (failing with `failureClass: "unclaimed"`)
  - The reaper's definition-less arm requeues a single-CR visit whose claimant goes offline

Out of scope:
  - `onboard` tasks (handled in-process by `handleOnboard`; never dispatched as an Agent CR)
  - Actual Kubernetes CR creation (the claiming cluster-agent does this; the Floor only enqueues)
  - Satellite cluster registration and telemetry (FR5–FR8, separate from the dispatch path)

NOTE: All acceptance tests were already green before this DOD task ran. The ticket
was implemented in commit 45eaf99b ("one mode in every cluster", 2026-08-29), which
made `AgentCrStationBackend` write `queued` station runs for single-CR task types
and removed the `HttpAgentApi.create` push path. No new failing tests exist to
write — the behavior is already implemented and verified.
