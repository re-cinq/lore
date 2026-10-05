# Definition of Done

> Station maps each node outcome to the correct `triage:*` label and calls `project.issues.addLabel`

**Strategy: `direct`** — The seam is `runTriageLabelStation(input, deps)` in the new module; the test injects a fake `project.issues.addLabel` and asserts the correct label is produced for each outcome. The module does not exist yet, so every test fails at import.

## Done when these pass

- [x] **maps outcome `<outcome>` to label `triage: <outcome>` and calls addLabel** — eight parametric cases: each of the eight triage outcomes maps to its `triage:*` label and `project.issues.addLabel` is called with the correct issue number and label name
  `apps/stations/src/work/triage-label/triage-label.test.ts`

- [x] **fails when addLabel throws, so the walk can route to a failure edge** — when `project.issues.addLabel` rejects, the station returns `outcome: "failed"` rather than throwing
  `apps/stations/src/work/triage-label/triage-label.test.ts`

## Facets

- [x] Create `apps/stations/src/work/triage-label/triage-label.ts` exporting `runTriageLabelStation(input, deps)` and `triageLabelForOutcome(outcome)`
- [x] Create `apps/stations/src/work/triage-label/manifest.ts` exporting the `NodeStationModule` with `name: "triage-label"`, `runtime: "service"`, `outcomes: ["success", "failed"]`
- [x] Add `"triage-label": triageLabel` to `apps/stations/src/work/registry.ts` (including `STATION_NAMES` and `STATIONS`)
- [x] Add traceability parenthetical to FR14 in `specs/issue-triage/spec.md` (already present; FR7 reference in DoD was a numbering error)

## Out of scope

- The pipeline YAML `stations` block wiring (adding the `triage-label` node to `issue-triage.yaml`) — this is T005/T008 wiring work, not this station's implementation
- Creating the eight GitHub labels in the repository — the issues station refuses unknown labels, but that is an ops step outside this TypeScript implementation
- Any `NodeType`/`PRODUCIBLE_OUTCOMES` change in `libs/assembly-lines/src/assembly-line-schema.ts` — the ticket explicitly excludes this
