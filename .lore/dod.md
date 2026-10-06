# Definition of Done

> The `triage-label` node on the `reproduce` success branch transitions to `diagnose`; `diagnose` (on: success) → `triage-label` (which then routes to `verify`); `diagnose` (on: failed, iteration_max: 3) → `triage-label` → `done`.

**Strategy: `direct`** — `pipelineOfText` is the real entry point; the parsed `line.body.edges` array exposes the YAML graph topology directly so assertions on node routing require no stub. The `@re-cinq/floor-pipeline` parser respells `iteration_max` to `iterationMax` (camelCase); tests must use the floor's spelling, not the file's.

## Done when these pass

- [x] **routes issue-triage reproduce (success) through triage-label to diagnose** — `reproduce`'s success edge points to `triage-label`, not directly to `diagnose`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [x] **covers issue-triage diagnose edges: success → triage-label, failed (iteration_max: 3) → triage-label** — `diagnose` success and failed edges both route through `triage-label`; the failed edge carries `iterationMax: 3` (floor's camelCase spelling of YAML's `iteration_max`)
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [x] Add a `triage-label` service node to `issue-triage.yaml`
- [x] Change `reproduce (success) → diagnose` to `reproduce (success) → triage-label`
- [x] Add `triage-label (success) → diagnose` (or equivalent outgoing edge)
- [x] Change `diagnose (success) → verify` to `diagnose (success) → triage-label`
- [x] Change `diagnose (failed, iteration_max: 3) → done` to `diagnose (failed, iteration_max: 3) → triage-label`
- [x] Add outgoing edges from `triage-label` to `verify` and `done` (valid for a service node: success/failed coverage)
- [x] Add `diagnose` entry with `agent_definition: triage-diagnose` and `timeout_minutes: 10`
- [x] Fix test assertion to use `iterationMax` (floor's camelCase) instead of `iteration_max` (YAML file spelling)

## Out of scope

- The implementation of the `triage-diagnose` agent definition itself (prompt, model)
- The `verify` node wiring (covered by a separate task)
- The `human-gate` handoff logic
- Any changes to `apps/floor/src/events/handlers/github.ts`
