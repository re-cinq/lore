# Definition of Done

> Wire close-obsolete node into issue-triage.yaml

**Strategy: `direct`** — `seed-floor-pipelines.test.ts` already loads and parses every `libs/assembly-lines/src/floor-pipelines/*.yaml` file through `pipelineOfText`; the tests can call into that real entry point and assert against the parsed pipeline graph today.

## Done when these pass

- [ ] **close-obsolete station uses the close-issue service** — the `stations` block of `issue-triage.yaml` declares a `close-obsolete` entry whose `station` field is `close-issue`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [ ] **close-obsolete's only outgoing edge is always → done** — the pipeline's edge list has exactly one edge whose `from` is `close-obsolete`, and that edge's `on` is `always`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [ ] Add `close-obsolete` station entry in the `stations` block of `issue-triage.yaml` with `kind: service` and `station: close-issue`
- [ ] Add the node `close-obsolete` to `line.nodes` in `issue-triage.yaml`
- [ ] Add edge `close-obsolete` (on: always) → `done` to `line.edges`
- [ ] Confirm the `verify` (on: obsolete) → `close-obsolete` edge is present (set by T010 / #2288)

## Out of scope

- Implementing the `close-issue` station code itself (done in T005)
- Adding the `verify → close-obsolete` edge (done in T010 / #2288)
- Any other pipeline nodes (label nodes, decompose, etc.) — those belong to other tasks in this spec
