# Definition of Done

Strategy: direct

Why: `parseTaskTypesFile(COMMITTED)` already reads `scripts/task-types.yaml` and returns the parsed recipe prompts; the existing tests in `libs/shared/src/task-types/task-types-config.test.ts` already call it and assert on recipe content, so there is a live seam to reach through with one new assertion.

Acceptance tests:
  - libs/shared/src/task-types/task-types-config.test.ts::the acceptance-dod recipe > forbids self-referential source-reading meta-tests — the `acceptance-dod` prompt contains the word "meta-test", naming the failure mode it guards against

Facets (the red-green-refactor steps you expect, smallest first):
  - Add "meta-test" to the RULES section of the `acceptance-dod` recipe in `scripts/task-types.yaml`, explaining that a test whose assertions read a source/spec/config file is a meta-test, not an acceptance test, and is forbidden

Out of scope: changes to any other recipe; changes to the triage logic; changes to how tdd-round or pr-ready work
