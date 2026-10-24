# Definition of Done

> Update specs/github-issue-dispatch/spec.md to promote lore:triage and triage: needs-triage dispatch-table entries.

**Strategy: `mechanical`** — The ticket is a fully-specified edit to a Markdown file that owes no new permanent test. The indentation was corrected in the document.

## Done when these pass

- [x] **lore:triage label starts an issue-triage floor run with repo, issue_number, and issue_url args** — the existing test that must stay green
  `apps/stations/src/events/repo-handlers.test.ts`
- [x] **triage: needs-triage label also starts an issue-triage floor run** — the existing test that must stay green
  `apps/stations/src/events/repo-handlers.test.ts`

## Facets

- [x] Outdent the `lore:triage` and `triage: needs-triage` entry in the `specs/github-issue-dispatch/spec.md` dispatch list so it is no longer nested under the `lore` label block.

## Out of scope

- Formatting or indenting other labels not mentioned in the ticket.
