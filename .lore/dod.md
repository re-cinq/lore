# Definition of Done

> Human reconciliation of FR-7.3 and this generated ticket is needed; retain the working spec-tickets pipeline rather than restoring wizard/worker paths.

**Strategy: `mechanical`** — This is a document correction to synchronize the spec text (FR-11.6) with the already working `spec-tickets` pipeline (which includes `verify-implementation`) and link the existing test that pins this behavior.

## Done when these pass

- [x] **walks spec-tickets from load-tickets through decompose, verify-implementation and issues to issue-coverage and done, keyed on the run key** — The test ensuring the pipeline structurally has all nodes and routes correctly.
  `libs/assembly-lines/src/floor-pipelines/floor-pipelines.test.ts`
  > Test Files  1 passed (1)
  > Tests  113 passed (113)

## Facets

- [x] Rename the existing pipeline structural test to include `verify-implementation`.
- [x] Update `specs/7-feature-planning/spec.md` FR-11.6 text to include `verify-implementation`.
- [x] Add the validation link for FR-11.6 pointing to the renamed test.

## Out of scope

- Changing the `spec-tickets.yaml` pipeline structure (it is already correct and functional).
