# Definition of Done

> Spec projection completes with zero generative LLM client invocations, asserted by an existing behavioral test.

**Strategy: `mechanical`** — The ticket requests a regression test asserting zero LLM calls during projection; this is a fully-specified edit that adds the assertion to an existing behavioral test, owing no new acceptance test. The CI job `test` runs the tests to prove the green bar.

## Done when these pass

- [ ] **embeds a spec's 3 statements and 1 acceptance criterion in one embedder call of 4 texts** — the existing behavioral test asserting batching and zero LLM calls.
  `libs/shared/src/work/spec-trace/project-spec-file.test.ts`

## Facets

- [ ] Add `Llm` spy and zero-invocation assertion to the existing batching test.

## Out of scope

- Testing other projection edge cases or LLM usage outside `projectSpecFile`.
