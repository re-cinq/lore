# Definition of Done

> Verify node is correctly wired with its custom outcomes in the YAML.

**Strategy: `direct`** — The seam is the `loadBuiltinAssemblyLines()` function in `@re-cinq/lore-assembly-lines`, which reads every `*.yaml` file in `libs/assembly-lines/src/assembly-lines/`. The test loads the catalog and asserts the `verify` node's presence, station definition, timeout, and edge wiring. It fails today because `issue-triage.yaml` does not exist.

## Done when these pass

- [ ] **verify node covers every outcome with a matching outgoing edge** — the `issue-triage` assembly line exists in the builtin catalog; its `verify` node uses `station_ref: triage-verify`, `timeout_minutes: 10`, and has outgoing edges covering `success` → `human-gate` and `failed` → `label-failed` with no uncovered outcomes.
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [ ] Create `libs/assembly-lines/src/assembly-lines/issue-triage.yaml` with a `verify` agent node (`station_ref: triage-verify`, `timeout_minutes: 10`) wired `success` → `human-gate`, `changes_requested` → (appropriate node), `failed` → `label-failed`.
- [ ] Ensure the YAML passes the loader's schema and graph validation (no uncovered outcomes, no dangling edges).
- [ ] Run the acceptance test green.

## Out of scope

- Other nodes in the issue-triage assembly line (`reproduce`, `diagnose`, `human-gate`, `label-failed`, `close-obsolete`, `decompose`).
- The webhook label-routing changes in `apps/floor/src/events/handlers/github.ts`.
- Schema extension for custom outcome names (`obsolete`, `large-issue`, `not-actionable`) — these are expressed via `LORE_NODE_RESULT` extras, not new edge conditions.
