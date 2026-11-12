# Definition of Done

> The agreed no-selection behavior is explicit and tested: close the detail pane, or revise the original requirement to the persistent hint panel.

**Strategy: `mechanical`** — The persistent hint panel is already implemented and validated by existing tests; this is a documentation fix to align the specification with the verified implementation.

## Done when these pass

- [ ] **shows the select-a-node hint while every node is idle, and opens the inspector on a click** — Existing test that validates the persistent hint behaviour when no node is selected.
  `apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx`
- [ ] **renders the no-node-executions empty state instead of the hint for a run with no graph** — Existing test that validates the hint behavior when there is no node execution.
  `apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx`

## Facets

- [ ] Update `FR2` in `specs/assembly-line-run-detail/spec.md` to state that a persistent hint panel is shown instead of closing the detail pane, pointing to existing tests.

## Out of scope

- Redesigning the side panel behavior or modifying the hint panel's UI components.
