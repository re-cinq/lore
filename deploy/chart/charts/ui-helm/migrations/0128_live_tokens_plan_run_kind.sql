-- 0128_live_tokens_plan_run_kind: a `plan-run` live token opens one plan's
-- `plan-run` channel on the browser's one live socket (ADR-048), which follows
-- the plan's current planning run. Widens the kind check 0100 last set.

ALTER TABLE lore.live_tokens DROP CONSTRAINT IF EXISTS live_tokens_kind_check;
ALTER TABLE lore.live_tokens ADD CONSTRAINT live_tokens_kind_check
  CHECK (kind IN ('run', 'runs', 'plan-run'));
