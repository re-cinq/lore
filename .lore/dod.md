# Definition of Done

> Reconcile FR3.2's tab inventory with the current external-floor/Loops design; do not restore retired dark-factory or task routes merely to match stale wording.

**Strategy: `mechanical`** — This is a pure spec text update to align FR-3.2 with the already implemented and tested tab list in `layout.tsx`. (The tests are run by CI in the `Test` job as local test execution fails without a workspace build).

## Done when these pass

- [ ] **renders one Loops tab where Backlog and Triage were** — Pins that the rendered layout includes Loops instead of older tracking tabs
  `apps/web-ui/src/app/repos/[owner]/[repo]/layout.test.tsx`

## Facets

- [ ] Update FR-3.2 in `specs/4-ux-repo-onboarding/spec.md` to list the current tabs: Overview, Context, Assembled, Specs, Plans, Changelog, Loops, ADRs, Graph, Agents, Settings.
- [ ] Run formatter and spec linter to update links.

## Out of scope

- Adding or removing actual tabs in the React layout.
