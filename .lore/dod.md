# Definition of Done

> `human-gate` MUST be declared as a `kind: human` station entry in the floor pipeline YAML's `stations` block with `route: '{args.issue_url}'`

**Strategy: `direct`** — the seam already exists: `seed-floor-pipelines.test.ts` reads every YAML from `libs/assembly-lines/src/floor-pipelines/` via `realFiles()` and parses them with `pipelineOfText`, so tests can call through to the real pipeline loader today and fail on absent behaviour.

## Done when these pass

- [x] **declare the lines … issue-triage …** — the shipped pipeline list includes `issue-triage`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [x] **declares issue-triage human-gate as a kind: human station with route '{args.issue_url}'** — the station named `human-gate` in the YAML's `stations` block has `kind: human` and `route: '{args.issue_url}'` (FR16)
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [x] **routes issue-triage human-gate's success edge to done** — the `success` edge from the `human-gate` node leads to the `done` exit node (FR8)
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [x] Create `libs/assembly-lines/src/floor-pipelines/issue-triage.yaml` with the three-block floor format (`line`, `stations`, `agent_definitions`)
- [x] Add a `human-gate` entry to the `stations` block with `kind: human` and `route: '{args.issue_url}'`
- [x] Add a `human-gate` node to `line.nodes` wired from `verify`'s `success` output
- [x] Add edge: `human-gate` on `success` → `done`
- [x] Update `floor-pipelines.test.ts` pinned-list test to include `issue-triage` (that test will break when the YAML is added)

## Out of scope

- All other nodes in `issue-triage.yaml` (reproduce, diagnose, verify, close-obsolete, triage-label, decompose) — those belong to other tasks in the plan
- The `github.issues.labeled` handler that resumes the parked visit (T006 / FR8's second half)
- The `triage_label` service station and triage label taxonomy (FR14)
- The `close-obsolete` service station (FR15)
- Agent recipe `.md` files for triage-reproduce, triage-diagnose, triage-verify (FR12)
