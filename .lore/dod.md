# Definition of Done

> FR model projections explicitly says toRow raises for an unbound field; toRow only iterates the column map and silently omits a record field absent from that map. wireSchema's own missing-binding check does not prove toRow's runtime contract.

**Strategy: `direct`** — `toRow` is a pure function that can be tested directly with an unbound field to verify its behavior matches the runtime contract.

## Done when these pass

- [x] **raises for a field the map does not bind** — raises an error if the record has a field not bound by the column map, instead of silently dropping it.
  `libs/shared/src/lib/row.acceptance.test.ts`

## Facets

- [x] Iterate over `Object.keys(record)` in `toRow` and use `enforceTrue` to assert each field is bound by `columns`.

## Out of scope

- Adjusting `wireSchema`, which already implements the unbound-field refusal check correctly.