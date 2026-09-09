-- 0070_run_stream_notify: the fan-out behind the run page's live stream
-- (specs/assembly-line-run-viz FR7, ADR-037 amendment 2026-09).
--
-- lore-api serves one multiplexed SSE stream per assembly run. It learns that
-- something changed from Postgres itself: every table the page reads gets an
-- AFTER trigger that NOTIFYs the `lore_run_stream` channel with an ids-only
-- JSON payload, and the stream session re-reads the row it names. Triggers
-- rather than app-level NOTIFY because pipeline.station_runs has eight
-- writers across two processes -- a publish each writer must remember is the
-- invariant that eventually breaks. NOTIFY delivers at commit, so a listener's
-- follow-up read always sees the row.
--
-- Payloads carry ids only (8000-byte NOTIFY cap). Identical payloads inside
-- one transaction collapse, so a 500-row agent_run_events batch is one
-- notification per run.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS. Runs as
-- `lore`, the owner -- no superuser needed.

CREATE OR REPLACE FUNCTION pipeline.notify_run_stream() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payload TEXT;
BEGIN
  IF TG_TABLE_NAME = 'agent_run_events' THEN
    payload := json_build_object('kind', 'agent_event', 'run', NEW.assembly_line_id)::text;
  ELSIF TG_TABLE_NAME = 'station_runs' THEN
    payload := json_build_object('kind', 'node_status', 'run', NEW.assembly_run_id, 'row', NEW.id)::text;
  ELSIF TG_TABLE_NAME = 'assembly_runs' THEN
    payload := json_build_object('kind', 'run_status', 'run', NEW.id)::text;
  ELSIF TG_TABLE_NAME = 'task_events' THEN
    payload := json_build_object('kind', 'task_event', 'task', NEW.task_id, 'id', NEW.id)::text;
  ELSIF TG_TABLE_NAME = 'events' THEN
    payload := json_build_object('kind', 'ci_check', 'repo', NEW.params->>'repo', 'pr', NEW.params->>'pr_number')::text;
  ELSE
    RETURN NULL;
  END IF;

  PERFORM pg_notify('lore_run_stream', payload);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS run_stream_agent_run_events ON pipeline.agent_run_events;
CREATE TRIGGER run_stream_agent_run_events
  AFTER INSERT ON pipeline.agent_run_events
  FOR EACH ROW WHEN (NEW.assembly_line_id IS NOT NULL)
  EXECUTE FUNCTION pipeline.notify_run_stream();

DROP TRIGGER IF EXISTS run_stream_station_runs ON pipeline.station_runs;
CREATE TRIGGER run_stream_station_runs
  AFTER INSERT OR UPDATE OF status, outcome, claimed_at, finished_at, commit_sha, cluster_agent_id
  ON pipeline.station_runs
  FOR EACH ROW
  EXECUTE FUNCTION pipeline.notify_run_stream();

DROP TRIGGER IF EXISTS run_stream_assembly_runs ON pipeline.assembly_runs;
CREATE TRIGGER run_stream_assembly_runs
  AFTER UPDATE OF status, outcome, reason, finished_at ON pipeline.assembly_runs
  FOR EACH ROW
  EXECUTE FUNCTION pipeline.notify_run_stream();

DROP TRIGGER IF EXISTS run_stream_task_events ON pipeline.task_events;
CREATE TRIGGER run_stream_task_events
  AFTER INSERT ON pipeline.task_events
  FOR EACH ROW
  EXECUTE FUNCTION pipeline.notify_run_stream();

-- pipeline.events is the hottest insert path; the WHEN predicate keeps every other event name out of the trigger.
DROP TRIGGER IF EXISTS run_stream_check_events ON pipeline.events;
CREATE TRIGGER run_stream_check_events
  AFTER INSERT ON pipeline.events
  FOR EACH ROW WHEN (NEW.event_name LIKE 'github.check_%')
  EXECUTE FUNCTION pipeline.notify_run_stream();
