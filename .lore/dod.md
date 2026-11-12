# Definition of Done

> Reconcile the stale named interface/no-new-components requirements with the current chosen-attempt implementation; do not restore retired log paths. Behavioral log selection itself is covered.

**Strategy: `mechanical`** — The actual single-attempt log contract is already shipped and tested; the specification and the original ticket requirements were stale and referred to the removed NodePodLogs component. The fix rewrites the spec to align with the deployed architecture.

## Done when these pass

- [x] **shows attempt 1's pod logs when the attempt select picks it** — asserts the pod log rendering behavior for a selected node and attempt
  `apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx`
- [x] **shows the newest attempt's pod logs alone once Pod logs is chosen** — asserts the pod log rendering behavior for a selected node and attempt
  `apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx`

## Facets

- [x] Update `FR2` in `specs/assembly-line-run-detail/spec.md` to remove references to `NodePodLogs` being passed down from `page.tsx` and instead state that `AttemptInspector` uses `AgentAttemptCard` and `NodeLogPanel`.
- [x] Update `FR5` in `specs/assembly-line-run-detail/spec.md` to replace the "No new components" constraint with a mention of the newly introduced attempt log components.
- [x] Update `Out of Scope` and `Alternatives Rejected` sections to mention the original legacy pod log section rather than `NodePodLogs`.

## Out of scope

- Behavioral changes to how `NodeLogPanel` or `RunVisualizationPanel` operate; they are already shipped.
