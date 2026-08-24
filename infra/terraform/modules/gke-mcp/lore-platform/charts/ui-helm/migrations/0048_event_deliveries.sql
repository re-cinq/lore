-- 0048_event_deliveries: one delivery row per (event, subscriber), so more than
-- one consumer can react to the same event.
--
-- pipeline.events is a work QUEUE -- one row per event, claimed FOR UPDATE SKIP
-- LOCKED -- so exactly one consumer ever sees a given event. That is correct for
-- a single drain loop and fatal for stations, which need to react to events the
-- Floor also reacts to. Adding a second drainer to the queue would have it STEAL
-- the Floor's rows, and dead-letter each stolen name it has no handler for,
-- immediately and without retry.
--
-- The claim moves onto the delivery row. Each subscriber gets its own, so it
-- retries on its own ladder, cannot starve another, and -- the property that
-- motivated this -- drains its OWN backlog after downtime instead of having
-- missed what happened while it was gone.
--
-- visibility_timeout_seconds is per delivery, not global. The reaper presumed
-- every handler dead at 600s regardless of the budget its work declared, so a
-- longer handler was re-queued while still running, executed concurrently with
-- itself, and burned its attempts until it dead-lettered -- deterministically,
-- every run. Nothing exceeds the old ceiling today; this is fixed now because
-- the table is being created now.
--
-- No trigger creates these rows. The schema is pure DDL and a trigger would be
-- the first stored procedure in it: untestable by the unit suite, invisible to
-- TypeScript, and revisable only through a migration runner that is append-only
-- and skip-by-filename, where editing an applied file is silently inert. The
-- rows are created by one exported SQL clause (libs/shared/src/project/events/
-- fan-out.ts) composed into the same statement as each event insert -- which is
-- also what keeps the two CTE writers atomic, since a run row without its start
-- event never runs.

CREATE TABLE IF NOT EXISTS pipeline.event_subscriptions (
  subscriber                 TEXT   NOT NULL,
  event_name                 TEXT   NOT NULL,
  -- Stamped onto each delivery at fan-out; the subscriber's declared budget.
  visibility_timeout_seconds INT    NOT NULL DEFAULT 600,
  registered_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber, event_name)
);

CREATE TABLE IF NOT EXISTS pipeline.event_deliveries (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- CASCADE so pruning an event cannot orphan a delivery. The prune itself must
  -- refuse to delete an event that still has an unhandled one.
  event_id        BIGINT NOT NULL REFERENCES pipeline.events(id) ON DELETE CASCADE,
  subscriber      TEXT   NOT NULL,
  status          TEXT   NOT NULL DEFAULT 'pending',
  attempts        INT    NOT NULL DEFAULT 0,
  error           TEXT,
  claimed_at      TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at      TIMESTAMPTZ,
  visibility_timeout_seconds INT NOT NULL DEFAULT 600,
  -- Makes fan-out idempotent: re-running it for an event adds no second row.
  UNIQUE (event_id, subscriber)
);

-- Subscriber-first: each consumer scans only its own backlog. Without this every
-- drainer paginates through everyone else's pending rows on each 1s tick.
CREATE INDEX IF NOT EXISTS event_deliveries_claim_idx
  ON pipeline.event_deliveries (subscriber, next_attempt_at, id)
  WHERE status IN ('pending', 'failed');

-- The reaper's scan: rows left in flight by a crashed claimer.
CREATE INDEX IF NOT EXISTS event_deliveries_stuck_idx
  ON pipeline.event_deliveries (claimed_at)
  WHERE status = 'processing';

-- The orphan alert's scan: recent events nobody subscribed to. Cheap because the
-- events table is pruned hourly.
CREATE INDEX IF NOT EXISTS event_deliveries_event_idx
  ON pipeline.event_deliveries (event_id);

-- Ownership + least privilege, following 0045. The migration runs AS `lore`, so
-- these are a no-op on a fresh create and repair a table created by any other
-- role. lore_ui reads only, and only if that role exists (it does not on GKE).
GRANT ALL ON pipeline.event_deliveries TO lore;
GRANT ALL ON pipeline.event_subscriptions TO lore;
GRANT USAGE, SELECT ON SEQUENCE pipeline.event_deliveries_id_seq TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.event_deliveries TO lore_ui';
    EXECUTE 'GRANT SELECT ON pipeline.event_subscriptions TO lore_ui';
  END IF;
END$$;
