# Definition of Done

> The eight `triage:*` labels (`triage: needs-triage`, `triage: needs-reproduction`, `triage: reproduced`, `triage: unable-to-reproduce`, `triage: diagnosed`, `triage: skipped`, `triage: not-actionable`, `triage: failed`) MUST be created in each onboarded repository by `libs/shared/src/work/onboard/enrol-repo.ts`

**Strategy: `direct`** — The seam is `createDispatchLabels` in `onboard-audit.ts`, called by `enrolRepo`. The existing test harness captures every label name passed to `createLabels`, so a test that calls `enrolRepo` and asserts each of the eight labels is present fails today because `dispatchLabelSeed()` does not include any `triage:*` labels.

## Done when these pass

- [x] **creates all eight triage:\* labels on a freshly enrolled repository** — asserts that calling `enrolRepo` causes all eight `triage:*` labels defined in FR14 to be included in the labels passed to `createLabels`
  `libs/shared/src/work/onboard/enrol-repo.test.ts`

## Facets

- [x] Add a `TRIAGE_LABEL_SEED` constant (or inline array) with the eight labels and their colors/descriptions to `dispatchLabelSeed()` in `libs/shared/src/work/onboard/onboard-audit.ts`
- [x] Run the test suite to confirm the new test goes green and the four existing tests still pass
- [ ] Confirm the backfill path for already-enrolled repositories (the ticket notes a one-off backfill is owed; out of scope for this ticket's test)

## Out of scope

- The one-off backfill for repositories already enrolled before this line existed
- Any other FR14 sub-requirements (triage state machine, label roles, label colors beyond what looks reasonable)
- All other FRs in the issue-triage spec
