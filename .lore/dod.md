# Definition of Done

> `coveredRangesByFile` in `libs/shared/src/work/spec-trace/ingest-test-report.ts` folds every result into a map keyed by the test **file**, and `coverageRecordsFor` emits one record per file with `testFile === testName === <the file path>`. The `Coverage` node is attached to the file-scoped `TestChunk` (the one whose `test_name` IS the file path), not to the per-`it` chunks.

**Strategy: `direct`** — the seam is `ingestTestReport` in `libs/shared/src/work/spec-trace/ingest-test-report.ts`. The test exercises it directly against a live Dgraph, following the repository's established pattern for this file (`describe.skipIf(!reachable)`). Tests skip in the DoD pod (no Dgraph) and run in CI where Dgraph is available.

## Done when these pass

- [x] **attaches a per-test Coverage node to the per-it TestChunk keyed by test name** — after `ingestTestReport` with one per-`it` descriptor and a covered range, the per-`it` `TestChunk` (xid `repo|a.test.ts::A > x`) has a `TestChunk.coverage` edge pointing to a `Coverage` node with `xid = repo|a.test.ts|x` (testFile|testName). Currently fails because `coverageRecordsFor` emits `testName = file` (file path), so `findTestChunkUid` resolves the file-scoped chunk instead of the per-`it` one, and the per-`it` TestChunk gets no coverage edge.
  `libs/shared/src/work/spec-trace/ingest-test-report.test.ts`

## Facets

- [x] Change `coverageRecordsFor` in `ingest-test-report.ts` to also emit one `CoverageRecord` per result keyed on the descriptor name (`testFile: descriptor.file, testName: descriptor.name`) so `findTestChunkUid` can match the per-`it` `TestChunk`
- [x] Keep the existing file-level record alongside the new per-test ones (the ticket says "alongside", not "instead of")
- [x] Update the existing test "creates one Coverage node per file and attaches HAS_COVERAGE to the file-scoped TestChunk for many per-it descriptors" which currently asserts `toHaveLength(1)` — after the fix there will be more coverage nodes per repo

## Out of scope

- Changes to `validatedByImpact` or the pre-merge impact check — the ticket explicitly defers this to its own PR with before/after on a real repo
- Changes to `tests_covering(file, range)` query shape — the ticket notes file granularity is adequate for the #1770 use-case
- Updates to the spec prose in `specs/spec-traceability-graph/spec.md` describing coverage granularity — the ticket asks for this but it is editorial work the implementation round owns
