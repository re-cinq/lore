# Definition of Done

> Nothing reads or writes `pipeline.credit_ledger` any more.

**Strategy: `mechanical`** — the edits are two fully-specified lines: one forward-only migration (`DROP TABLE IF EXISTS pipeline.credit_ledger;`) and one tombstone sentence in `specs/1-lore-platform/spec.md` FR-19.27. The behaviour — that no code queries `credit_ledger` — is already pinned by an existing passing test.

## Done when these pass

- [ ] **"carries no budget block and never reads a credit ledger"** — confirms the spend-window route neither returns a `budget` field nor issues any SQL against `pipeline.credit_ledger`; passes today and must stay green after the migration file lands.
  `apps/lore-api/src/transport/routes/analytics/spend-window.test.ts`

## Facets

- [ ] Add `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/0078_drop_credit_ledger.sql` containing `DROP TABLE IF EXISTS pipeline.credit_ledger;` (idempotent, same pattern as `0008_drop_v2_spec_coverage_tables.sql`).
- [ ] In `specs/1-lore-platform/spec.md` FR-19.27, replace the sentence "The `pipeline.credit_ledger` table (migration 0045) is left in place: it is in no baseline schema script, so a later forward-only migration can drop it once its entries are confirmed unneeded." with "The `pipeline.credit_ledger` table (migration 0045) is dropped by migration 0078."

## Out of scope

- Exporting existing ledger rows before dropping — the ticket requires the operator to confirm they are unneeded as a manual step outside this change.
- Any change to API routes, the web UI, or application TypeScript — all reads and writes of `credit_ledger` were already removed.
