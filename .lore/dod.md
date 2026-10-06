# Definition of Done

> Wire reproduce node into issue-triage.yaml

**Strategy: `direct`** — `pipelineOfText()` from `@re-cinq/floor-pipeline` (used by `seed-floor-pipelines.ts`) is the real entry point; the test loads the actual YAML from `libs/assembly-lines/src/floor-pipelines/` and asserts the station's properties and edges. No seam is missing.

## Done when these pass

- [ ] **reproduce station is a kind: agent station with agent_definition triage-reproduce** — the reproduce station in the floor pipeline YAML carries `kind: agent` and `agent_definition: triage-reproduce`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts#L151`

- [ ] **reproduce station declares custom outcomes [unable-to-reproduce, needs-reproduction, skipped]** — the `outcomes` field is present on the reproduce station
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts#L161`

- [ ] **all edges from reproduce route to triage-label** — every outgoing edge from reproduce routes to `triage-label`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts#L173`

## Facets

- [x] Add `reproduce` station to `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with `kind: agent`, `agent_definition: triage-reproduce`, `timeout_minutes: 15`, `outcomes: [unable-to-reproduce, needs-reproduction, skipped]`
- [x] Add five edges from `reproduce` to `triage-label`: on success, unable-to-reproduce, needs-reproduction, skipped, and failed (iteration_max: 3)
- [ ] All three tests green — blocked: acceptance test at L157 checks `body["agent_definition"]` but `pipelineOf` from `@re-cinq/floor-pipeline` renames this to `body["agentDefinition"]`; the test should read `["agentDefinition"]` to match the library's camelCase conversion

## Out of scope

- Adding the `triage-label` node's own edges or logic (T009 and subsequent tasks)
- The `diagnose`, `verify`, `decompose` stations (separate tickets)
- SC-002 through SC-007 success criteria measurement (no telemetry emitted by this line)
- The `diagnose` route from the success-branch `triage-label` node (added in T009)
