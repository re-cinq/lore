# Definition of Done

> Update specs/github-issue-dispatch/spec.md to promote lore:triage and triage: needs-triage from a planned note to real dispatch-table entries in the 'What Changes' section, naming apps/stations/src/events/repo-handlers.ts.

**Strategy: `mechanical`** — The behaviour is already implemented and the handler tests (T006) already validate it. The only work owed is replacing the `([from plan](...))` annotation on the dispatch-table entry with `([validated by ...])` links to the existing tests, which pins the claim to real code rather than a plan URL.

## Done when these pass

- [ ] **lore:triage label starts an issue-triage floor run with repo, issue_number, and issue_url args** — existing test that the `lore:triage` label fires `startIssueTriage`
  `apps/stations/src/events/repo-handlers.test.ts`

- [ ] **triage: needs-triage label also starts an issue-triage floor run** — existing test that the `triage: needs-triage` label also fires `startIssueTriage`
  `apps/stations/src/events/repo-handlers.test.ts`

## Facets

- [x] Replace `([from plan](...))` on the `lore:triage`/`triage: needs-triage` bullet in `specs/github-issue-dispatch/spec.md` with `([validated by ...])` links to the two existing tests in `apps/stations/src/events/repo-handlers.test.ts#L176` and `#L193`.

## Out of scope

- New production code — the handler already exists.
- New tests — the two existing tests are the proof.
- Any other spec files — only `specs/github-issue-dispatch/spec.md` is owed by this ticket.
