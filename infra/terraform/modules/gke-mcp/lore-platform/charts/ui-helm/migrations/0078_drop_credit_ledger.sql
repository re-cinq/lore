-- 0078_drop_credit_ledger: drop pipeline.credit_ledger now that the
-- spend-balance feature is retired.
--
-- The operator-recorded credit balance was removed from /spend
-- (branch fix/remove-spend-balance): the Balance section, the top-up
-- form, POST /api/spend/credits, and the budget block on
-- GET /api/analytics/spend-window are gone. No code reads or writes
-- pipeline.credit_ledger any more.
--
-- The table was created by migration 0045_credit_ledger.sql. It is not
-- in any baseline schema script, so this forward-only drop is safe on
-- a fresh cluster (IF EXISTS makes it idempotent).

DROP TABLE IF EXISTS pipeline.credit_ledger;
