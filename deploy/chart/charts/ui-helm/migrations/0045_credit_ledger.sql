-- 0045_credit_ledger: the operator-entered record of money added to the
-- Anthropic account, so /spend can show what is LEFT and not only what was
-- spent.
--
-- Why a table and not a derived figure: Anthropic's Admin API exposes usage
-- and cost reports only -- there is no credit-balance endpoint, so the balance
-- cannot be fetched and has to be told to us. Each row is one such telling.
--
-- Append-only by convention: a wrong entry is corrected with a compensating
-- row (kind = 'correction', amount_usd negative), never an UPDATE. That keeps
-- every INSERT atomic -- no read-modify-write race between two people
-- recording a top-up at once -- and keeps the audit trail intact.
--
-- amount_usd is in DOLLARS, matching pipeline.anthropic_cost_daily.cost_usd,
-- so the two sides of `remaining = ledger - spend` share a unit.
--
-- effective_at is a TIMESTAMP, not a date, and that is the whole point. A
-- top-up recorded at 14:30 on a healthy balance must not have the morning's
-- spend charged against it, and a date column can only ever answer to the
-- nearest midnight. Anthropic's cost report is day-bucketed and cannot be
-- split, but it never emits the in-progress day either -- so the day an entry
-- is recorded is always covered by pipeline.llm_calls, whose created_at is a
-- real timestamp. The precision is available exactly where it is needed.
--
-- It is also when the money LANDED, which is not always when it was recorded
-- (created_at). Spend counts from the earliest effective_at, so a balance
-- entered late still anchors to the right moment.
--
-- Idempotent: safe to re-run. `pipeline` is owned by `lore` (the migration
-- runner), so this applies through the Helm hook with no operator step --
-- same channel as 0014_dark_factory_audit_log.

CREATE TABLE IF NOT EXISTS pipeline.credit_ledger (
  id           BIGSERIAL PRIMARY KEY,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount_usd   NUMERIC NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'topup',
  note         TEXT NOT NULL DEFAULT '',
  actor        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guarded so a re-run against a table that already carries the constraint is a
-- no-op rather than a duplicate_object failure.
DO $$
BEGIN
  ALTER TABLE pipeline.credit_ledger
    ADD CONSTRAINT credit_ledger_kind_check
    CHECK (kind IN ('opening', 'topup', 'correction'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- A zero-dollar entry moves no balance and only muddies the ledger.
DO $$
BEGIN
  ALTER TABLE pipeline.credit_ledger
    ADD CONSTRAINT credit_ledger_amount_nonzero
    CHECK (amount_usd <> 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

GRANT ALL ON pipeline.credit_ledger TO lore;
GRANT USAGE, SELECT ON SEQUENCE pipeline.credit_ledger_id_seq TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.credit_ledger TO lore_ui';
  END IF;
END$$;
