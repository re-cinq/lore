# Definition of Done

> The run views draw THAT graph too: the API serves it and web-ui stopped keeping…

**Strategy: `mechanical`** — The ticket asks for an update to `CLAUDE.md` to reflect that the web-ui draws the run graph from the API, rather than keeping a hand-transcribed copy. This does not change code behaviour, so no new test is owed.

## Done when these pass

- [ ] **draws the graph the run RECORDED, not a transcription of today's yaml** — validates that web-ui draws the recorded graph from the API.
  `apps/web-ui/src/lib/run-graph-definition.test.ts`

## Facets

- [ ] Update `CLAUDE.md` to mention that web-ui draws THAT graph and stopped keeping a hand-transcribed copy of the builtin YAMLs.

## Out of scope

- Behavioural changes to how graphs are stored, resolved, or rendered.