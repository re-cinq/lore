# Definition of Done

> The linked TestChunk test asserts the label 'validated by' as test_name instead of resolving the actual test, so the 'right test_name' requirement remains unproven.

**Strategy: `direct`** — The projection seam is reachable by the `projectSpecFile` live graph test. We can pass the test file content in via `readLinked` and assert `test_name`. The red bar is CI's to show; the `integration` job runs `npm run test:dgraph -w @re-cinq/lore-shared`.

## Done when these pass

- [ ] **projectSpecFile acceptance (live Dgraph)** — Link correctly resolves test title from `readLinked` contents and sets `TestChunk.test_name`.
  `libs/shared/src/work/spec-trace/project-spec-file.acceptance.test.ts`

## Facets

- [x] Extract test declarations using `testTitleAt` for TestChunk projection.
- [x] Feed `readLinked` content into test chunk link projection.

## Out of scope

- Production verification of existing spec file links beyond fixing the projection logic to resolve test names correctly.
