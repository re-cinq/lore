# Definition of Done

> Verify node is correctly wired with its custom outcomes in the YAML.

**Strategy: `direct`** — The seam is the `issue-triage.yaml` floor pipeline file at `libs/assembly-lines/src/floor-pipelines/`, read by `pipelineOfText` in `seed-floor-pipelines.ts`. The test loads the real files and asserts the `triage-verify` station and its custom outcome edges exist. It fails today because `triage-verify` is not declared in the `stations` block of `issue-triage.yaml`.

## Done when these pass

- [ ] **triage-verify station declares custom outcomes and every declared outcome has a matching outgoing edge from the verify node** — the `triage-verify` station exists in the `issue-triage` pipeline's `stations` block and every outcome it declares has a corresponding outgoing edge from the `verify` node.
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [ ] Add a `triage-verify` entry to the `stations` block in `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` declaring outcomes `[success, obsolete, large-issue, not-actionable, failed]` and `agent_definition: triage-verify`.
- [ ] Wire the verify node: `success` → `human-gate`, `obsolete` → `close-obsolete`, `large-issue` → `decompose`, `not-actionable` → `label-not-actionable`, `failed` (with `iteration_max: 3`) → `label-failed`.
- [ ] Run the acceptance test green.

## Out of scope

- The `triage-verify` agent definition recipe file (`libs/shared/src/agent-defaults/triage-verify.md`) — covered by T002.
- The `close-obsolete`, `decompose`, `label-not-actionable`, `label-failed` nodes and their wiring — covered by T009, T012, T013 and the label node tasks.
- The `iteration_max: 3` retry semantics — the test checks edge existence, not iteration count (FR25 is covered by T009).
