# Definition of Done

> Reconcile the spec's any-test-href rule and narrative hover category with graph-driven rendering; current tests inject desired states rather than proving those original outcomes.

**Strategy: `direct`** — The `SpecDetails` component provides a clear UI seam where we can render markdown and graph-derived `StatementInfo`, observing whether the generated HTML correctly marks coverage and exposes the narrative category.

## Done when these pass

- [ ] **determines a statement is tested by finding a test link mid-statement, overriding a graph state of untested** — asserts that `SpecDetails` sets the `tested` state by locating the `<a>` element, overriding a graph `untested` state.
  `apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.acceptance.test.tsx`
- [ ] **surfaces the narrative section category in the hover popover** — asserts that the tooltip renders the narrative category passed in `StatementInfo`, which is wired from the graph's `testability` field.
  `apps/web-ui/src/app/repos/[owner]/[repo]/specs/SpecDetails.acceptance.test.tsx`

## Facets

- [ ] Update `trace-statement-info.ts` to map `GraphStatement.testability` to `StatementInfo.category`.
- [ ] Refactor `statement-highlight.ts` and `SpecDetails` rehype pipeline to evaluate `stmt-tested` state dynamically by locating test links in the markdown.

## Out of scope

- Extracting actual test links from the markdown for the popover (existing component tests show it currently uses the `testLinks` prop array).
