# Definition of Done

> applied against a live Dgraph, declares each traceability node type's xid as a hash upsert index and every embedding predicate as a float32vector HNSW index, the relationship edges as uid lists, and the violated/violation_reason fields on the Statement and AcceptanceCriterion types; it is idempotent on re-apply and coexists with the memory schema (Memory.xid stays intact).

**Strategy: `parallel-change`** — the test points at a newly-introduced `setup-spec-trace-schema.ts` module, running beside the existing `setup-spec-trace-schema.sh` applier.

## Done when these pass

- [ ] **declares the Statement xid upsert index and the Statement embedding HNSW vector index** — proves the vectors and indices are present.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **declares every traceability node type's xid as a hash upsert index** — proves all nodes' `xid` are hashed.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **declares every embedding predicate as a float32vector HNSW index** — proves `embedding` fields are vector typed.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **declares the relationship edge predicates as uid lists** — proves the node relationships.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **lists Statement.violated and Statement.violation_reason in the Statement type** — proves fields exist.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **lists AcceptanceCriterion.violated and AcceptanceCriterion.violation_reason in the type** — proves fields exist.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **declares CodeChunk.references and CodeChunk.imports as uid list predicates for the call graph** — proves the call graph node edges.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **is idempotent — a second apply leaves the predicate schema unchanged** — applies a second time and checks no structural change.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **coexists with the memory schema — Memory.xid stays intact on the shared cluster** — proves Memory schema is preserved.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **declares Overlay.xid as a hash upsert index so a branch's overlay upserts independently of main** — proves `Overlay.xid` indexes.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`
- [ ] **declares the Overlay chunk edges as uid lists so a branch's nodes hang off it instead of the Repo root** — proves `Overlay` relations.
  `libs/shared/src/outbound/setup-spec-trace-schema.acceptance.test.ts`

## Facets

- [x] Create `libs/shared/src/outbound/setup-spec-trace-schema.ts`.
- [x] Implement `setupSpecTraceSchema(client: DgraphClientPort)` implementing the Dgraph schema applying logic.
- [ ] Make the tests pass against a live Dgraph.

## Out of scope

- Switching current callers of `setup-spec-trace-schema.sh` over to the new module; that is the second phase of a parallel change.
