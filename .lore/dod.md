# Definition of Done

> Reconcile the initial-ingestion task with the workflow-driven design; demonstrate actual workflow ingestion records last_ingested_at only after a successful write, without restoring retired Floor ingestion jobs.

**Strategy: `direct`** — A seam exists in the `/api/ingest` route, which handles workflow ingestion directly and needs to update the repository timestamp when files land.

## Done when these pass

- [ ] **records last_ingested_at only after a successful write** — verifies `/api/ingest` updates the timestamp when files land.
  `apps/lore-api/src/transport/routes/ingest/ingest.acceptance.test.ts`
- [ ] **does not record last_ingested_at when no files landed** — verifies `/api/ingest` skips updating the timestamp when no files landed.
  `apps/lore-api/src/transport/routes/ingest/ingest.acceptance.test.ts`

## Facets

- [ ] `/api/ingest` calls `markIngested` when `anyFileLanded` is true.

## Out of scope

- Restoring retired Floor ingestion jobs.