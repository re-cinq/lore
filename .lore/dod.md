# Definition of Done

> The Add Spec form remains functional, or its removal is explicitly reconciled in the issue/spec.

**Strategy: `mechanical`** — The ticket is a fully-specified edit updating the spec to explicitly reconcile the removal of the Add Spec form (removed because specs are projected automatically by CI). No new permanent test is owed.

## Done when these pass

- [ ] **SpecCard and SpecListView remain green** — The UI components that render the specs page without the form must continue to pass their existing tests.
  `apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecCard.test.tsx`
  `apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecListView.test.tsx`

## Facets

- [x] Remove "The Add Spec form is preserved unchanged" from T106, T016, and T040 in `specs/spec-test-coverage/tasks.md`.
- [x] Amend AC 6 in `specs/spec-test-coverage/spec.md` to state the Add Spec form is removed because specs are auto-projected by CI on push.

## Out of scope

- Restoring the Add Spec form.
