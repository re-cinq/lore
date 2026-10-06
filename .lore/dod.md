# Definition of Done

> Wire decompose node into issue-triage.yaml

**Strategy: `direct`** — The seam already exists: `pipelineOfText` in `seed-floor-pipelines.ts` parses the real YAML files, and `seed-floor-pipelines.test.ts` already asserts properties of the parsed pipelines. Adding tests that assert the `decompose` station and its `always` edge exercises real pipeline content through the real entry point.

## Done when these pass

- [ ] **wires issue-triage decompose as a feature-decompose agent station** — the `decompose` station exists in `issue-triage.yaml` with `kind: agent` and `agent_definition: feature-decompose`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [ ] **routes issue-triage decompose on always to done** — the `issue-triage` line's edges include `{ from: "decompose", on: "always", to: "done" }`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [x] In `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` `stations` block, add `decompose` entry: `kind: agent`, `agent_definition: feature-decompose`
- [x] Add edge `from: decompose / to: done / on: always` to the `line.edges` list
- [ ] Confirm (do not add) the `verify` (on: large-issue) edge already points to `decompose` — set by T010 (#2259)
- [ ] Fix acceptance test bug: `seed-floor-pipelines.test.ts:156` checks `body.agent_definition` (snake_case) but `pipelineOf` from `@re-cinq/floor-pipeline` converts it to `body.agentDefinition` (camelCase); the test will always return `undefined` as written — needs to check `body.agentDefinition` OR the package must stop renaming station fields. Note: spec FR20 also says decompose MUST NOT use `feature-decompose`, contradicting this ticket and the DoD test.

## Out of scope

- Adding the `verify → decompose` edge (set by T010, a dependency of this ticket)
- Adding any other pipeline nodes (reproduce, diagnose, label-*, close-obsolete) — covered by sibling tickets
- A separate `triage-decompose` agent recipe — FR6 says the recipe should differ from `feature-decompose`, but the ticket explicitly specifies `agent_definition: feature-decompose` and that is what the acceptance tests assert
