# Lore Derived Code Graph

| Field  | Value |
|--------|-------|
| Status | Implemented |

At ingest time, for every onboarded repo, derive and write graph edges that today exist only if someone calls `lore_write_episode`:

- Statement 1. After one ingest, `lore_query_graph({entity: "<library>"})` returns a `depends-on` edge from the consumer carrying the `github:` specifier and `pinned: false`. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L55)) ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.test.ts#L5)) ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.test.ts#L18)) ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.test.ts#L29)) ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.test.ts#L40)) ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.test.ts#L46))
- Statement 2. `lore_query_graph({entity: "<exported symbol>", relation_type: "uses"})` returns the importing files with their repos; an export with no importers returns an explicit derived-and-empty result, distinguishable from not-derived. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L63)) ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L73))
- Statement 3. The `exports` edge set for the library lists each public export of its entry module with kind and source path. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L83))
- Statement 4. A per-repo import-set query returns exactly the symbols the consumer imports and shows zero importers for the library's unused modules. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L91))
- Statement 5. `lore_query_graph({entity: "<subclass>"})` returns an `extends` edge to its base type with the added member and its source path. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L100))
- Statement 6. Re-ingesting an unchanged repo produces an identical edge set: derivation is deterministic and needs no `lore_write_episode`. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.acceptance.test.ts#L107))
- Statement 7. Edges are derived for all onboarded repos, including those where `auto_ingest_graph` is off. ([validated by](apps/lore-api/src/work/spec-trace/derive-code-graph.test.ts#L57))
