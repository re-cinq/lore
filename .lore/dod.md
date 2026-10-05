# Definition of Done

> This handler is the single entry point for all label-driven triage transitions. It must start a new issue-triage floor run for triage trigger labels, and resume a parked human-gate visit before the `activeTaskByIssue` check in `libs/shared/src/work/backlog/label-dispatch.ts` — otherwise the parked triage run causes the handler to answer 'Already being worked on' instead of advancing to implementation.

**Strategy: `parallel-change`** — `apps/stations/src/events/repo-handlers.ts` does not exist yet. Tests point at the new module; the existing label dispatch in `apps/floor/src/events/handlers/github.ts` continues handling other labels while the new triage handler is red.

## Done when these pass

- [ ] **lore:triage label starts an issue-triage floor run** — `createLabeledIssueHandler` calls `startLine("issue-triage", { repo, args: { repo, issue_url, issue_number } })` when the applied label is `lore:triage`.
  `apps/stations/src/events/repo-handlers.test.ts`

- [ ] **triage: needs-triage label also starts an issue-triage floor run** — same handler, same behavior for the alternative triage trigger label.
  `apps/stations/src/events/repo-handlers.test.ts`

- [ ] **lore:implementation resumes the parked visit before activeTaskByIssue fires** — `reportToVisit` is called for the parked human-gate node before the `activeTaskByIssue` check, so the run advances rather than being blocked as 'already being worked on'.
  `apps/stations/src/events/repo-handlers.test.ts`

## Facets

- [ ] Create `apps/stations/src/events/repo-handlers.ts` exporting `createLabeledIssueHandler(deps: LabeledIssueDeps)` and `type LabeledIssueDeps`.
- [ ] Implement the `lore:triage` / `triage: needs-triage` branch: call `deps.startLine("issue-triage", { repo, args: { repo, issue_url, issue_number } })`.
- [ ] Implement the `lore:implementation` branch: call `deps.findParkedTriage(repo, issueNumber)`, then if found call `deps.reportToVisit(target, "success")`, then check `deps.activeTaskByIssue`, then dispatch.
- [ ] Wire `createLabeledIssueHandler` into the stations event loop (subscribe to `github.issues.labeled`).
- [ ] Create `libs/shared/src/outbound/floor/floor-client.ts` implementing `startLine` (calls `floor.lines.start` via the event bus).
- [ ] Create `libs/shared/src/outbound/floor/floor-report.ts` implementing `reportToVisit` (calls `reportToParkedNode`).

## Out of scope

- Other labels not mentioned in the ticket (`priority:*`, `lore:blocked`, etc.) — handled by the existing Floor dispatch.
- `libs/shared/src/work/backlog/label-dispatch.ts` internal implementation details — the test only cares that `reportToVisit` fires before `activeTaskByIssue`.
- FR9 batching, FR16 human-gate YAML declaration, and SC-009 metric — covered by other tickets.
