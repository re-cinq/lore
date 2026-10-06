# Definition of Done

> Wire reproduce node into issue-triage.yaml

**Strategy: `direct`** — `loadBuiltinAssemblyLines()` from `@re-cinq/lore-assembly-lines` is the real entry point; the test loads the actual YAML and asserts the node's properties and edges. No seam is missing.

## Done when these pass

- [ ] **reproduce station has timeout_minutes of 15** — the reproduce node in `issue-triage.yaml` carries `timeout_minutes: 15`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [ ] **reproduce station declares custom outcomes [unable-to-reproduce, needs-reproduction, skipped]** — the `outcomes` field is present on the reproduce node after the schema (`assembly-line-schema.ts`) is extended to support it
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [ ] **all edges from reproduce route to triage-label** — every outgoing edge from reproduce (success, unable-to-reproduce, needs-reproduction, skipped, failed) routes to `triage-label`, which requires adding the `triage-label` node and extending `EdgeCondition` with the three custom outcomes
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [ ] Extend `EdgeCondition` enum in `assembly-line-schema.ts` with `unable-to-reproduce`, `needs-reproduction`, `skipped`
- [ ] Add `outcomes` optional field to `NodeSchema` in `assembly-line-schema.ts`
- [ ] Update `PRODUCIBLE_OUTCOMES` map for `agent` type to include the three new outcomes
- [ ] Add `triage-label` node to `issue-triage.yaml`
- [ ] Update `reproduce` node: add `agent_definition: triage-reproduce`, `timeout_minutes: 15`, `outcomes: [unable-to-reproduce, needs-reproduction, skipped]`
- [ ] Replace existing reproduce edges (to `verify`/`done`) with five edges to `triage-label`: success, unable-to-reproduce, needs-reproduction, skipped, and failed (iteration_max: 3)
- [ ] All three tests green

## Out of scope

- Adding the `triage-label` node's own edges or logic (T009 and subsequent tasks)
- The `diagnose`, `verify`, `decompose` stations (separate tickets)
- SC-002 through SC-007 success criteria measurement (no telemetry emitted by this line)
- The `diagnose` route from the success-branch `triage-label` node (added in T009)
