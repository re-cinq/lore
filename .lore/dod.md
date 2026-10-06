# Definition of Done

> The sweep starts a floor run per qualifying issue, oldest first, respecting the concurrency cap.

**Strategy: `direct`** — the `issueTriageTick(params, deps)` function is the seam: it takes all I/O through a `deps` interface, so tests call it with a real floor stub and assert on its behaviour. The function does not exist yet, making the tests red at import time.

## Done when these pass

- [ ] **starts a floor run per qualifying issue, oldest first, each run independently** — verifies the sweep calls `floor.lines.start('issue-triage', ...)` once per `triage: needs-triage` issue in oldest-first order, with each call carrying only that issue's args (no shared context)
  `apps/stations/src/work/issue-triage-tick/issue-triage-tick.test.ts`

- [ ] **respects the per-repo concurrency cap: starts only as many runs as the remaining capacity allows** — verifies the sweep stops starting runs once `runningCount + started >= cap` for the repo
  `apps/stations/src/work/issue-triage-tick/issue-triage-tick.test.ts`

## Facets

- [ ] Create `apps/stations/src/work/issue-triage-tick/issue-triage-tick.ts` exporting `issueTriageTick(params, deps)` and `IssueTriageTickDeps` (follow the `digestTick` pattern)
- [ ] Create `apps/stations/src/work/issue-triage-tick/run.ts` binding deps to the process's real ports (floor client, GitHub issues query)
- [ ] Create `apps/stations/src/work/issue-triage-tick/manifest.ts` subscribing to `cron.issue_triage.tick`
- [ ] Add `issue_triage` emitter to `CRON_EMITTERS` in `libs/shared/src/work/scheduler/cron-emitters.ts`
- [ ] Register `issue-triage-tick` in `apps/stations/src/work/registry.ts` (the existing registry test is also red once the folder exists)
- [ ] Add spec validated-by link on FR9 in `specs/issue-triage/spec.md`

## Out of scope

- Creating the `issue-triage` floor pipeline YAML (covered by separate tickets)
- The GitHub issues query for `triage: needs-triage` label (implementation detail of `run.ts`)
- The `TaskTypeSchema` / `TRUST_LEVELS` registration for `issue-triage` (covered by T003)
- The `floor.lines.start` wiring for the labeled-event path (covered by T006)
