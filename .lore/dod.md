# Definition of Done

> run page: `node "fix-ci" failed: BackoffLimitExceeded: Job has reached the specified backoff limit — The pod died rather than the work failing — a crash, an OOM, an eviction, or a Job deadline.`

**Strategy: `changes_requested`** — The `failure_detail` shown on the run page comes from `visit.report?.error` (mapped in `floor-run-mapping.ts:283` and `loop-closed.ts:166`). The floor (re-cinq/floor) currently sets that field to the Job-level `BackoffLimitExceeded` reason. Reading the pod's `containerStatuses[].state.terminated.reason` before the Job controller deletes the pod — so that `report.error` says "OOMKilled: agent exceeded its 1Gi memory limit" — requires a change in re-cinq/floor. Lore holds no Kubernetes client (`CLAUDE.md`: "Lore holds no Kubernetes client") and cannot observe the pod's termination reason. The lore-side mapping from `report.error` → `failure_detail` is already correct and tested (FR13.8, `loop-closed.test.ts:146`, `floor-run-mapping.test.ts:296`). No acceptance test in this repo can fail for the stated reason.

## Done when these pass

- [ ] **No new tests** — the lore-side mapping is already correct; the fix belongs in re-cinq/floor
  `apps/stations/src/code-review/run-settled/loop-closed.test.ts` (existing, already green)

## Facets

- [ ] File this ticket against re-cinq/floor: when the floor's Job watch sees `BackoffLimitExceeded`, it should read the pod's `containerStatuses[].state.terminated.reason` before the pod is deleted and report that as `visit.report.error` (e.g. "OOMKilled: agent exceeded its 1Gi memory limit" or "Evicted: …" or "DeadlineExceeded: …").
- [ ] The memory limit ("1Gi") can be read from the pod's `spec.containers[name=agent].resources.limits.memory` at the same moment.
- [ ] Once the floor sends the specific reason, lore's existing mapping propagates it to `failure_detail` with no further change.

## Out of scope

- Any change to lore-api, lore-stations, web-ui, or libs/shared — those already correctly pass through whatever `report.error` the floor sends.
- A lore-side translation layer that guesses OOMKilled from BackoffLimitExceeded without the Kubernetes API.
