# Definition of Done

> Derive cross-repo depends-on, imports, exports and extends graph edges at ingest

**Strategy: `direct`** — The `ingestFiles` entry point provides the direct seam to observe derived edges written to the live knowledge graph during ingestion. The red bar is CI's to show; the `lore-api` job in `pr-checks.yml` runs the tests.

## Done when these pass

- [ ] **Acceptance suite in `derive-code-graph.acceptance.test.ts`** — verifies `depends-on`, `uses`, `exports`, and `extends` edges are derived across repos, deterministic on re-ingest, and independent of `auto_ingest_graph`. Seven tests:
  - emits a depends-on edge from the consumer to the library
  - returns the importing file for a used symbol
  - returns a none sentinel for an export with no importers
  - lists each public export of the entry module in an exports edge set
  - per-repo import set contains used symbols and omits unused ones
  - emits an extends edge from the subclass to its base type
  - re-ingesting an unchanged repo produces an identical edge set
  `apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts`

## Facets

- [x] Implement `depends-on` edge derivation from `package.json`
- [x] Implement `uses` and `exports` derivation from code imports/exports
- [x] Implement `extends` derivation for class inheritance
- [x] Ensure edge derivation is deterministic on re-ingestion
- [x] Fix `queryLiveGraph` incoming-direction SQL so entity=source, related_entity=target (acceptance test assertions require this)
- [ ] Unify derivation for all onboarded repos (remove `auto_ingest_graph` opt-in constraint)

## Out of scope

- Consumer-shaped questions asked on top of the derived edges
- Work in one repo gating work in another
- The write path for repo settings
- Declared contracts attached to symbols
- Honest empty results from the search tools
