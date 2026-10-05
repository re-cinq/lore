# Definition of Done

> This handler is the single entry point for all label-driven triage transitions. It must start a new issue-triage floor run for triage trigger labels, and resume a parked human-gate visit before the `activeTaskByIssue` check in `libs/shared/src/work/backlog/label-dispatch.ts` — otherwise the parked triage run causes the handler to answer 'Already being worked on' instead of advancing to implementation.

**Strategy: `direct`** — `apps/stations/src/events/repo-handlers.ts` exists; `repoEventHandlers` is the real entry point. Tests call it directly and fail on missing behavior.

## Done when these pass

- [ ] **lore:triage label starts an issue-triage floor run** — `repoEventHandlers` calls `deps.startIssueTriage(repo, issueNumber, issueUrl)` when the applied label is `lore:triage`.
  `apps/stations/src/events/repo-handlers.test.ts`

- [ ] **triage: needs-triage label also starts an issue-triage floor run** — same handler, same behavior for the alternative triage trigger label.
  `apps/stations/src/events/repo-handlers.test.ts`

- [ ] **lore:implementation resumes the parked visit before activeTaskByIssue fires** — `deps.reportTriageGate(visitId)` is called for the parked human-gate visit before the `activeTaskByIssue` check in `dispatchLabeledIssue`, so the run advances rather than being blocked as 'already being worked on'.
  `apps/stations/src/events/repo-handlers.test.ts`

## Facets

- [ ] Extend `RepoEventDeps` with `startIssueTriage`, `findParkedTriageVisit`, and `reportTriageGate`.
- [ ] In `issueLabeled`, detect `lore:triage` / `triage: needs-triage` labels and call `deps.startIssueTriage`.
- [ ] In `issueLabeled`, for `lore:implementation`, call `deps.findParkedTriageVisit`; if found call `deps.reportTriageGate` BEFORE delegating to `dispatchLabeledIssue`.
- [ ] Wire the three new deps in the station's composition root.

## Out of scope

- Other labels not mentioned in the ticket (`priority:*`, `lore:blocked`, etc.) — handled by the existing label dispatch.
- `libs/shared/src/work/backlog/label-dispatch.ts` internal implementation details — the test only cares that `reportTriageGate` fires before `activeTaskByIssue`.
- FR9 batching, FR16 human-gate YAML declaration, and SC-009 metric — covered by other tickets.
