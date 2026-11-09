# Definition of Done

> Reconcile/remove the retired artifact-copy requirement or implement it; make the public-barrel contract and its guard agree with the hierarchical source tree.

**Strategy: `mechanical`** — The ticket asks to update a test that asserts on source text (the barrel guard) and to remove a retired spec requirement; this cannot be expressed as a behavioural entry point, so it owes no new test.

## Done when these pass

- [x] **public barrel (index.ts)** — the existing barrel guard that must stay green after being updated to check recursively.
  `libs/shared/src/index.test.ts`

## Facets

- [x] Remove `FR — artifact-copy` from `specs/shared-utilities/spec.md`.
- [x] Update the barrel guard in `libs/shared/src/index.test.ts` to find `.ts` files recursively under `src/`.
- [x] Update `libs/shared/src/index.ts` to export all discovered non-test modules to make the updated guard pass.

## Out of scope

- Implementing the retired `artifact-copy` behaviour.
