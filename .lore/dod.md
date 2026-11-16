# Definition of Done

> A valid report containing <class filename="src/b.go"><lines><line hits="1" number="5"/></lines></class> produces no covered chunks, although XML attribute order does not change the reported hit.

**Strategy: `direct`** — The `runOneFile` package-level function is a callable entry point we can test directly with a Cobertura report where the `hits` attribute appears before `number`. The red bar is CI's to show (`lore-code-trace` job) because Go is not installed in this pod.

## Done when these pass

- [ ] **TestParseCoberturaReversedAttributes** — A report where `hits` precedes `number` yields correct coverage chunks.
  `apps/lore-code-trace/coverage.acceptance_test.go`

## Facets

- [ ] Modify `cobLine` regex in `apps/lore-code-trace/coverage.go` to match attributes independent of their order.

## Out of scope

- Testing other coverage formats (LCOV, JSON) attribute ordering.