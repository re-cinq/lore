# Definition of Done

> A file that always fails blocks later files in its batch; isolate per file or record whole-batch retry as intended.

**Strategy: `direct`** — The active document-delta path (`applyDocDelta`) can be tested directly via the route handler to observe if later files are projected despite an earlier failure.

## Done when these pass

- [x] **projects later files in a batch even if an earlier file fails** — ensures that a failing middle file does not abort the projection of subsequent files in the same batch, and the batch still reports the failure.
  `apps/lore-api/src/transport/routes/ingest/ingest-delta.acceptance.test.ts`

## Facets

- [x] Catch file projection errors in `projectFiles` loop and record them, continuing the loop.
- [x] Throw an aggregate error at the end of `projectFiles` if any files failed, so the run fails.

## Out of scope

- Handling of failed whole-batch retries or refactoring the graph store transaction strategy.
