# Definition of Done

Ticket claim: "The spec-traceability graph has `CodeChunk` nodes (`symbol_name`, `file_path`, `start_line`/`end_line`, `content_hash`, `embedding`) but **no edge between two chunks**. There is no `REFERENCES` and no `IMPORTS` predicate anywhere in `scripts/infra/setup-spec-trace-schema.sh`."

Strategy: direct

Why: Three seams are already exercisable. The schema is tested via the live-Dgraph skipIf suite in `setup-spec-trace-schema.test.ts` (will skip locally, fail in CI). The `runQueryTrace` function uses injected `proxyGet`, making the callers-routing test a pure assertion on the URL pattern chosen. `buildImpactAnnotations` is a pure function whose annotation_level is already assertable without Dgraph.

Acceptance tests:
  - libs/shared/src/outbound/setup-spec-trace-schema.test.ts::declares CodeChunk.references and CodeChunk.imports as uid list predicates for the call graph — schema declares both `CodeChunk.references` and `CodeChunk.imports` as `[uid]` list predicates (skips when Dgraph unreachable; fails in CI)
  - libs/server-core/src/work/spec-trace/query-trace.test.ts::routes a callers_of query to a callers endpoint rather than the document endpoint — `runQueryTrace` must proxy to a callers endpoint when `callers_of` is supplied (not the document endpoint)
  - libs/shared/src/work/spec-trace/trace-impact.test.ts::renders indirect statements as notice-level rather than warning so they appear in a quieter PR section — `buildImpactAnnotations` must return `annotation_level: "notice"` for statements with `indirect: true`

Facets (smallest first):
  - Add `CodeChunk.references` and `CodeChunk.imports` predicate lines to `setup-spec-trace-schema.sh` and their type entries to the `CodeChunk` type block
  - Add `indirect?: boolean` to `ImpactStatement` in `impact-statement.ts`; update `buildImpactAnnotations` to use `"notice"` for indirect statements
  - Extend `QueryTraceArgs` with `callers_of?` / `callees_of?` / `depth?`; add routing in `runQueryTrace` to `/api/repos/${repo}/trace/callers?symbol=...`
  - Add the reference extractor (tree-sitter second pass for TS/JS and Go) to the projection path; emit `{ from_xid, to_xid }` pairs and resolve in the same upsert transaction
  - Extend `fileImpact` in `trace-impact.ts` to expand touched chunks by one hop of `~CodeChunk.references` and mark those results `indirect: true`

Out of scope: external dependency graph (npm/go.mod), branch-aware references (issue #1769), Ruby/Python/Java extractors, `gc-orphan-chunks.ts` edge cleanup (noted as needed but not the red bar).
