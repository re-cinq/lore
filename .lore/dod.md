# Definition of Done

> Complete the bundled runtime-criteria audit, especially FR-15 continuation/retry behavior in the external engine; retain the confirmed lint implementation.

**Strategy: `direct`** — The pipeline lint already provides a seam via `pipelineProblems(yamlText, prompts)`, and we can directly assert that unbounded retries and unresolvable conversation keys report the appropriate runtime-criteria problems statically.

## Done when these pass

- [ ] **unbounded-retry** — reports unbounded-retry for a back-edge to the same node without iteration_max
  `libs/assembly-lines/src/pipeline-lint.acceptance.test.ts`
- [ ] **unresolvable-conversation-key** — reports unresolvable-conversation-key for a station whose conversation_key is not a declared arg
  `libs/assembly-lines/src/pipeline-lint.acceptance.test.ts`

## Facets

- [ ] Add `unbounded-retry` rule logic mapping back-edges lacking iteration_max.
- [ ] Add `unresolvable-conversation-key` rule logic mapping conversation_keys against pipeline args.
- [ ] Add schema support or extract `iteration_max` and `conversation_key` in `pipeline-lint-shape.ts` to expose to the linter.

## Out of scope

- Runtime modification of the external floor engine itself (the audit applies only to the static pipeline checks).
