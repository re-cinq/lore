# spec-coverage-backfill

Weekly (Mon 11:00 UTC). Backfills inline `([validated by …](path#Lline))` links
for testable spec statements missing test coverage. Per spec: segment →
classify (heuristic + LLM fallback) → extract assertions → select candidates →
judge each → apply edits → open a PR. Idempotent against statement-text edits;
skips repos with no recent code activity.

- **Entry point:** `index.ts` → `specCoverageBackfillJob()`
- **Job name:** `spec_coverage_backfill` — `npm run job -- spec_coverage_backfill`
- **Tests:** `spec-coverage-backfill.test.ts`
- Borrows `isAssertionSource` from `../spec-drift/spec-drift-rules.js`.
