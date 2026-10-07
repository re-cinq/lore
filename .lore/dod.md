# Definition of Done

> Issue #1768 is closed and PR #1914 is merged, but the capability it describes does not work end to end. Three of its four acceptance criteria are unmet on `main` today.

**Strategy: `direct`** — `TRACE_KINDS` in `trace.ts` and `INGEST_KINDS` in `ingest-graph-registry.ts` are both real, callable entry points; tests call them through the live server and the real ingest selector respectively.

## Done when these pass

- [x] **callers is a recognised trace kind and does not return 404** — `GET /api/repos/o/r/trace/callers?symbol=nextTransition` currently returns 404 because `callers` is absent from `TRACE_KINDS`; the fix must add the kind and a handler.
  `apps/lore-api/src/transport/routes/trace/trace-callers.test.ts`

- [x] **selects TypeScript source files for the code kind** — `selectIngestFiles(TREE, 'code')` currently returns `[]` because `INGEST_KINDS` has no `code` entry; the fix must register the kind so TypeScript source files are picked up for code-chunk projection (the precondition for `extractImportedCallSites` to have production callers and for `CodeChunk.references` edges to be written).
  `libs/shared/src/work/spec-trace/ingest-code-kind.test.ts`

## Facets

- [x] Add `callers` to `TRACE_KINDS` in `apps/lore-api/src/transport/routes/trace/trace.ts` and implement the handler (query `CodeChunk.references` in Dgraph; degrade to empty when no Dgraph client is configured, mirroring the `failures-touching` pattern).
- [x] Add a `code` kind to `INGEST_KINDS` in `libs/shared/src/work/spec-trace/ingest-graph-registry.ts` with a `prefixes` or glob that selects TypeScript/JavaScript source files (excluding test files).
- [ ] Implement `projectCodeFile` (or wire the code kind's `project` function) to call `extractImportedCallSites(ext, content)` and write the results as `CodeChunk.references` edges in Dgraph.
- [x] Update the stale comment at `ingest-graph-registry.ts:69` — "CodeChunks are coverage-defined (minted by `ingestCoverageReport`)" is no longer accurate once a code kind exists.
- [ ] Add `~CodeChunk.references` to `CHUNK_OWNER_EDGES['CodeChunk']` in `gc-orphan-chunks.ts` so that a chunk that is only referenced by another chunk's `references` edge is GC'd when the referencing chunk is deleted.

## Out of scope

- The MCP tool (`callers_of`/`callees_of`/`depth` arguments) was already fixed on this branch; no further work is owed there.
- Whole-repo re-projection for pre-existing files (the first projection pass is sufficient; incremental handling is a separate concern).
- Writing `CodeChunk.imports` edges (the schema already declares the predicate; this ticket asks for `CodeChunk.references`, which `extractImportedCallSites` produces).
