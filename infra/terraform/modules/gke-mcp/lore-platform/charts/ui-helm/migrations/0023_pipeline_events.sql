-- 0023_pipeline_events: the single trigger substrate for the Floor event loop.
--
-- The Floor is moving to a 3-layer event architecture: listeners (github webhook
-- ingress, the k8s Agent-CR watch, cron-tick emitters, mcp-server post-ingest)
-- INSERT one row per occurrence; a single drain loop atomically claims unhandled
-- rows and dispatches to handlers via a registry keyed on event_name; the
-- handlers are the existing tasks/jobs. This replaces the scattered
-- mcp→/api/trigger/* fan-out, the poll-based agent watcher, and direct cron
-- execution. Event names are source-prefixed and globally unique
-- (github.* / kubernetes.* / cron.* / internal.*).
--
-- The `pipeline` schema is owned by `lore` (the migration runner), so this CREATE
-- applies cleanly through the normal channel. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS pipeline.events (
  id              BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name      TEXT         NOT NULL,                    -- 'github.pull_request.synchronize'
  source          TEXT         NOT NULL,                    -- github | kubernetes | cron | internal
  params          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      TEXT,                                     -- nullable; UNIQUE-when-present (idempotency)
  status          TEXT         NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed|dead
  attempts        INT          NOT NULL DEFAULT 0,
  error           TEXT,
  captured_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  handled_at      TIMESTAMPTZ
);

-- Idempotent inserts: producers set dedupe_key and use ON CONFLICT DO NOTHING.
-- Partial so rows without a natural key are still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_key_uniq
  ON pipeline.events(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- The claim hot-path: runnable rows, oldest-first.
CREATE INDEX IF NOT EXISTS events_claim_idx
  ON pipeline.events(next_attempt_at, id) WHERE status IN ('pending', 'failed');

-- Operational lookups (dead-letter inspection, by-name).
CREATE INDEX IF NOT EXISTS events_status_idx ON pipeline.events(status, captured_at DESC);
CREATE INDEX IF NOT EXISTS events_name_idx   ON pipeline.events(event_name, captured_at DESC);
