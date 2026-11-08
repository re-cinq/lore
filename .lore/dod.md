# Definition of Done

> The linked spec-grouping contract says a spec.md-less folder is titled from its key. The implementation selects sorted[0] as primary when spec.md is absent and then uses primary.title whenever nonempty. For a single {filePath:"specs/auth/plan.md", title:"Plan", description:""}, the card title is "Plan", not "auth".

**Strategy: `direct`** — `groupSpecSummaries` provides a direct seam to test the grouping logic for spec summaries.

## Done when these pass

- [ ] **titles a spec.md-less folder from its key, not from a sibling file's title** — folder derives its title from its key when spec.md is absent, even if other files have titles.
  `apps/web-ui/src/lib/spec-grouping.acceptance.test.ts`

## Facets

- [ ] Handle the absence of `spec.md` separately from the absence of its title

## Out of scope

- UI rendering or changes to `SpecListView` itself.
