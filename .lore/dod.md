# Definition of Done

> A human reconciles FR settings-form's auto_review yes/no requirement with the current settings flow, or the form produces both required boolean outcomes.

**Strategy: `mechanical`** — The `auto_review` switch was moved to the Loops tab, so the settings form no longer writes this value. The correct fix is to mechanically remove the obsolete `auto_review from yes/no` requirement from the spec. The existing `settings-form` tests continue to pin the remaining fields correctly.

## Done when these pass

- [ ] **existing settings-form fields parsing** — the remaining spec requirements are still pinned by existing tests.
  `apps/web-ui/src/lib/settings-form.test.ts`

## Facets

- [ ] Remove `auto_review from yes/no` from `specs/shared-utilities/spec.md`.

## Out of scope

- No logic changes to `parseSettingsForm` or new tests are owed.
