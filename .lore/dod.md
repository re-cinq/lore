# Definition of Done

> Update libs/shared/src/index.ts
> Target file: `libs/shared/src/index.ts`
> How to test
> Test shared/src/index.ts

**Strategy: `direct`** — The module is the target and the acceptance test directly imports it to verify the subject_key functions are exported as required by FR6.51.

## Done when these pass

- [ ] **FR6.51: subject_key formatting functions are exported for API query construction** — pins that the module exports the subject formatting functions used in API queries.
  `libs/shared/src/index.acceptance.test.ts`

## Facets

- [ ] Export `planSubject`, `detectSubject`, `reviewSubject`, and `ingestSubject` from `libs/shared/src/outbound/project/assembly-runs/subject-keys.js` in `libs/shared/src/index.ts`.

## Out of scope

- Exporting other internal implementation details from `subject-keys.ts` that are not needed for query construction.
