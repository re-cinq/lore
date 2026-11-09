# Definition of Done

> The pinned ingest-workflow version contract consistently names the required canonical version.

**Strategy: `mechanical`** — The code correctly uses version 9 but the prose in `specs/shared-utilities/spec.md` incorrectly named versions 5 and 7. This mechanical edit resolves the contradiction.

## Done when these pass

- [ ] **ingest-workflow tests** — The tests that validate ingest-workflow behavior stay green.
  `libs/shared/src/work/ingest-workflow.test.ts`
- [ ] **web-ui ingest-workflow tests** — The web UI tests mirroring the logic stay green.
  `apps/web-ui/src/lib/ingest-workflow.test.ts`
- [ ] **web-ui ingest-workflow parity tests** — The parity tests proving both sides stay in sync stay green.
  `apps/web-ui/src/lib/ingest-workflow.parity.test.ts`

## Facets

- [x] Reconcile `specs/shared-utilities/spec.md` L93 from version 5 to version 9.
- [x] Reconcile `specs/shared-utilities/spec.md` L241 from version 7 to version 9 for the staleness threshold.

## Out of scope

- Changes to `LORE_INGEST_WORKFLOW_VERSION` logic or value.