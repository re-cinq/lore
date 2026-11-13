-- 0072_drop_legacy_events_status: retire the consume-side columns of pipeline.events.
--
-- Since ADR-044 every consumer drains its own pipeline.event_deliveries row;
-- nothing has written pipeline.events.status (or attempts/error/claimed_at/
-- next_attempt_at/handled_at) since the cutover, so every event ever captured
-- sat at the default 'pending' forever. On 2026-09-09 that read as a 104,000-row
-- undrained backlog and was escalated as an incident. The queue was fine; the
-- column was lying. Idempotent: safe to re-run.

DROP INDEX IF EXISTS pipeline.events_claim_idx;
DROP INDEX IF EXISTS pipeline.events_status_idx;

ALTER TABLE pipeline.events
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS attempts,
  DROP COLUMN IF EXISTS error,
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS handled_at;
