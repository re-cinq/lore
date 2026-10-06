# Definition of Done

> The `triage-label` node on the `reproduce` success branch transitions to `diagnose`; `diagnose` (on: success) → `triage-label` (which then routes to `verify`); `diagnose` (on: failed, iteration_max: 3) → `triage-label` → `done`.

**Strategy: `direct`** — `parseAssemblyLine` is the real entry point; the parsed `.edges` array exposes the YAML graph topology directly so assertions on node routing require no stub.

## Done when these pass

- [ ] **routes reproduce (success) through triage-label to diagnose** — `reproduce`'s success edge points to `triage-label`, not directly to `diagnose`
  `libs/assembly-lines/src/issue-triage-line.test.ts`

- [ ] **covers diagnose (success, failed) edges through triage-label** — `diagnose` success and failed edges both route through `triage-label`; the failed edge carries `iteration_max: 3`
  `libs/assembly-lines/src/issue-triage-line.test.ts`

## Facets

- [ ] Add a `triage-label` service node to `issue-triage.yaml`
- [ ] Change `reproduce (success) → diagnose` to `reproduce (success) → triage-label`
- [ ] Add `triage-label (success) → diagnose` (or equivalent outgoing edge)
- [ ] Change `diagnose (success) → verify` to `diagnose (success) → triage-label`
- [ ] Change `diagnose (failed, iteration_max: 3) → done` to `diagnose (failed, iteration_max: 3) → triage-label`
- [ ] Add outgoing edges from `triage-label` to `verify` and `done` (valid for a service node: success/failed coverage)
- [ ] Set `station_ref: triage-diagnose` and `timeout_minutes: 10` on the `diagnose` node

## Out of scope

- The implementation of the `triage-diagnose` agent definition itself (prompt, model)
- The `verify` node wiring (covered by a separate task)
- The `human-gate` handoff logic
- Any changes to `apps/floor/src/events/handlers/github.ts`
