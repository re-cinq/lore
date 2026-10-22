# Definition of Done

> Generate correct deterministic names for items.

**Strategy: `mechanical`** — The behaviour is already present and fully pinned by existing tests. This is a structural refactoring to align the codebase with the spec's assertion that one module (`names.ts`) builds them for every item, by extracting the section name generator into `names.ts`.

## Done when these pass

- [ ] **Section names are generated correctly** — the existing tests that pin section names must stay green
  `libs/shared/src/domain/utopia/docs/doc-statements.test.ts`
- [ ] **Statement and test names are generated correctly** — the existing tests that pin statement and test names must stay green
  `libs/shared/src/domain/utopia/test-coverage/test-report-statements.test.ts`

## Facets

- [ ] Export `sectionName(doc: string, slug: string): string` from `libs/shared/src/domain/utopia/names.ts`.
- [ ] Update `libs/shared/src/domain/utopia/docs/doc-sections.ts` to import and use `sectionName` instead of generating the name inline.

## Out of scope

- Behavioural changes to how names are generated or resolved.
