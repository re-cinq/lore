# Definition of Done

> 64 links across 12 specs don't resolve to a known test chunk or sit outside the trailing parenthetical.

**Strategy: `changes_requested`** — the claim is unactionable as stated. After verifying every referenced file in the current branch: several of the 64 links were already removed before this branch was created; the majority of the remaining "file-missing" links point to `it()` calls at the exact referenced line numbers and are valid — Lore reports them missing because its ingest database has not yet absorbed those test files (a freshness problem, not a link problem); and the external GitHub URL links (re-lint tests in a different repo) cannot be validated by Lore by design. No local acceptance test can fail because "Lore's database does not know this test chunk" without Lore API access. The one category that is genuinely wrong — `LogEntriesView.test.tsx#L231` points to a blank line rather than an `it()` start — can only be caught by reading spec-file text, which the acceptance-test rules prohibit.

## Done when these pass

No acceptance tests can be written. See Out of scope.

## Facets

- [ ] Determine policy for external GitHub URL links (`https://github.com/re-cinq/re-lint/...`): keep as cross-repo documentation references, or strip them to silence Lore.
- [ ] Confirm that the local-file "file-missing" links (`event-reporter.test.ts`, `dist.test.ts`, `RemoveOverrideButton.test.tsx`, `actions.test.ts`, `RunWorkbenchLayout.test.tsx`) go quiet after the next Lore CI ingest run — no edit needed.
- [ ] Fix `LogEntriesView.test.tsx#L231` → `#L233` (blank line vs. `it()` start); update label to `:233`. This is the only genuine href error in the surviving links.
- [ ] Fix `zod-validate.test.ts` label `:63` → `:65` to match the already-correct href `#L65`.

## Out of scope

- Writing acceptance tests: the ticket's validation criterion is Lore's database ("known test chunk"), which requires Lore API access and cannot be reproduced as a local vitest test.
- The majority of the reported 64 links (already removed from spec files before this branch or valid links not yet ingested by Lore) — no edit is owed for these.
- Any change to production or test code.
