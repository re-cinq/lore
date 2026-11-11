# Definition of Done

> Reconcile the obsolete GapResult criterion with the live-plan findings contract; do not silently drop it or rebuild the wizard.

**Strategy: `mechanical`** — The validation behaviour is already implemented and proven by existing tests; the task is a doc correction updating the spec and code docstrings to replace the obsolete GapResult wording with the live-plan findings contract.

## Done when these pass

- [x] **Validation blocks on missing findings** — fails and puts a fresh, unresolved blocker on the plan's first section when the validate visit delivered no findings file
  `apps/stations/src/planning/plan-findings/station.test.ts`

## Facets

- [x] Removed GapResult wording from FR-13.1 and aligned it with FR-19
- [x] Added FR-13.1 reference to the station docstring

## Out of scope

- Rebuilding the wizard or modifying production code
