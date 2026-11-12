# Definition of Done

> A chunk inserted through API ingest retains its exact content_hash when read back.

**Strategy: `direct`** — A seam already exists (`ingestFiles` and the `pg.Pool`). The test exercises a database round-trip for the inserted chunk's metadata. The red bar is CI's to show (the `test` CI job runs the database integration tests).

## Done when these pass

- [ ] **content_hash persistence** — Validates that a chunk inserted via `ingestFiles` persists its `content_hash` successfully when read back from the database.
  `apps/lore-api/src/integration-tests/ingest-roundtrip.acceptance.test.ts`

## Facets

- [x] Add an insert-boundary or database round-trip test asserting the actual stored content_hash.

## Out of scope

- Backfilling missing content_hash for already ingested chunks.
