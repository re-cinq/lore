-- 0100_live_tokens_runs_kind: a `runs` live token opens the external floor's
-- run list on the browser's one live socket (ADR-048), beside the per-run
-- `run` token. Widens the kind check 0091 created inline.

ALTER TABLE lore.live_tokens DROP CONSTRAINT IF EXISTS live_tokens_kind_check;
ALTER TABLE lore.live_tokens ADD CONSTRAINT live_tokens_kind_check
  CHECK (kind IN ('run', 'runs'));
