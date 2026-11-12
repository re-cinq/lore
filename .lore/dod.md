# Definition of Done

> Reconcile the requested Spec.blocks predicate with the implemented reverse Block.spec contract, or supply the required compatibility edge.

**Strategy: `direct`** — The Dgraph schema applier is tested directly against a live Dgraph instance. The red bar is CI's to show via the `Run live-Dgraph suites` step in `test-integration.yml`, which runs `npm run test:dgraph -w @re-cinq/lore-shared`.

## Done when these pass

- [ ] **declares Spec.blocks as a uid list predicate** — verifies the predicate is added to the Dgraph schema
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **lists Spec.blocks in the Spec type** — verifies the type definition is updated in the Dgraph schema
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`

## Facets

- [x] Add `Spec.blocks: [uid] @reverse @count .` to the predicate definitions in `scripts/infra/setup-spec-trace-schema.sh`
- [x] Add `Spec.blocks` to the `type Spec` definition in `scripts/infra/setup-spec-trace-schema.sh`
- [x] Mirror the predicate definition in `libs/shared/src/outbound/setup-spec-trace-schema.schema.ts`
- [x] Mirror the type definition in `libs/shared/src/outbound/setup-spec-trace-schema.schema-types.ts`

## Out of scope

- Updating the `upsertByXid` projection logic, since it correctly relies on the reverse traversal edge.
