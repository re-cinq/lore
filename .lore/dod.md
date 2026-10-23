# Definition of Done

> Derive cross-repo depends-on, imports, exports and extends graph edges at ingest

**Strategy: `direct`** — The `ingestFiles` entry point provides the direct seam to observe derived edges written to the live knowledge graph during ingestion. The red bar is CI's to show; the `lore-api` job in `pr-checks.yml` runs the tests.

## Done when these pass

- [ ] **derives and writes graph edges from code imports and package dependencies** — verifies `depends-on`, `uses`, `exports`, and `extends` edges are derived across repos, deterministic on re-ingest, and independent of `auto_ingest_graph`.
  `apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts`

## Facets

- [ ] Implement `depends-on` edge derivation from `package.json`
- [ ] Implement `uses` and `exports` derivation from code imports/exports
- [ ] Implement `extends` derivation for class inheritance
- [ ] Ensure edge derivation is deterministic on re-ingestion
- [ ] Unify derivation for all onboarded repos (remove `auto_ingest_graph` opt-in constraint)

## Out of scope

- Consumer-shaped questions asked on top of the derived edges
- Work in one repo gating work in another
- The write path for repo settings
- Declared contracts attached to symbols
- Honest empty results from the search tools
