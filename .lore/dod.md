# Definition of Done

> close-obsolete node correctly added to the YAML graph.

**Strategy: `direct`** — `seed-floor-pipelines.test.ts` already loads and parses every `libs/assembly-lines/src/floor-pipelines/*.yaml` file through `pipelineOfText`; the tests call into that real entry point and assert against the parsed pipeline graph.

## Done when these pass

- [x] **close-obsolete station uses the close-issue service** — the `stations` block of `issue-triage.yaml` declares a `close-obsolete` entry whose `station` field is `close-issue`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

- [x] **close-obsolete's only outgoing edge is always → done** — the pipeline's edge list has exactly one edge whose `from` is `close-obsolete`, and that edge's `on` is `always`
  `apps/lore-api/src/work/floor/seed-floor-pipelines.test.ts`

## Facets

- [x] Add `close-obsolete` node to `issue-triage.yaml` nodes block with `station: close-obsolete`
- [x] Add `close-obsolete` entry to the `stations` block with `kind: service` and `station: close-issue`
- [x] Add edge from `close-obsolete` to `done` with `on: always`
- [x] Add edge from `verify` to `close-obsolete` with `on: obsolete`

## Out of scope

- The `close-issue` station implementation itself (covered by FR15 in `apps/stations/src/issue-triage/close-issue/`)
- The full triage pipeline graph with label nodes (FR17)
- The `verify` agent node and its other edges
