# Definition of Done

> Update apps/stations/src/events/repo-handlers.ts github.issue_comment handler to re-apply triage: needs-triage if the issue has triage: needs-reproduction or triage: unable-to-reproduce.

**Strategy: `direct`** — `repoEventHandlers(deps)` is the real entry point; the test calls it and fires `github.issue_comment` events through the returned handler map. The handler is missing today, so `handlers.get("github.issue_comment")` returns `undefined` and the call throws.

## Done when these pass

- [ ] **reporter comment on a needs-reproduction issue re-applies triage: needs-triage** — firing `github.issue_comment` with an issue labeled `triage: needs-reproduction` causes `addLabel(issueNumber, "triage: needs-triage")` to be called
  `apps/stations/src/events/repo-handlers.test.ts`

- [ ] **reporter comment on an unable-to-reproduce issue re-applies triage: needs-triage** — firing `github.issue_comment` with an issue labeled `triage: unable-to-reproduce` causes `addLabel(issueNumber, "triage: needs-triage")` to be called
  `apps/stations/src/events/repo-handlers.test.ts`

## Facets

- [ ] Add `"github.issue_comment"` to the `REPO_EVENTS` constant in `repo-handlers.ts`
- [ ] Register an `issueComment` handler in `repoEventHandlers` that reads `issue.labels`, checks for `triage: needs-reproduction` or `triage: unable-to-reproduce`, and calls `(await deps.labelDispatch(repo)).addLabel(issue.number, "triage: needs-triage")`
- [ ] The two red tests turn green; the existing 9 tests stay green

## Out of scope

- FR19: posting a comment naming what the reporter must supply (the comment text lives in the pipeline YAML's station parameters, not in this handler)
- Any changes to the floor pipeline YAML or `triage_label` station
- The FR9 sweep itself — this ticket only wires the webhook re-entry point
