-- 0037_agent_run_turns: the full-fidelity turn store beside the truncated
-- run-visualization projection (specs/turn-level-transcript-store).
--
-- pipeline.agent_run_events is a deliberate projection: payloads are
-- byte-capped at write time and pruned after 14 days — right for the live SSE
-- view (ADR-037), wrong for post-mortems by design. The raw NDJSON goes to a
-- write-only GCS archive with no read path. This table closes that gap on the
-- Postgres the platform already operates: one row per stream-json line, the
-- UNTRUNCATED (but redacted) line in JSONB, the same write-time correlation
-- columns as the projection, and a longer retention (90 days, pruned by the
-- events cron).
--
-- NO FOREIGN KEYS — same skip-not-fail ingest posture as 0031: one bad row
-- under a FK would abort the batch insert.
--
-- id is a bigint identity; it exceeds Number.MAX_SAFE_INTEGER, so every
-- reader carries it as a string.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` (web-ui)
-- gets SELECT, guarded like 0031.

CREATE TABLE IF NOT EXISTS pipeline.agent_run_turns (
  id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id          TEXT         NOT NULL,
  agent_cr_name    TEXT,
  assembly_line_id UUID,
  node_id          TEXT,
  iteration        INT,
  event_type       TEXT         NOT NULL,  -- system | assistant | user | result | log
  payload          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- the turn-view scan: one line, ascending
CREATE INDEX IF NOT EXISTS agent_run_turns_line_idx
  ON pipeline.agent_run_turns(assembly_line_id, id) WHERE assembly_line_id IS NOT NULL;

-- per-task reads for turns that correlate to no assembly-line node
CREATE INDEX IF NOT EXISTS agent_run_turns_task_idx
  ON pipeline.agent_run_turns(task_id, id);

-- the retention prune scan
CREATE INDEX IF NOT EXISTS agent_run_turns_created_idx
  ON pipeline.agent_run_turns(created_at);

GRANT ALL ON pipeline.agent_run_turns TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.agent_run_turns TO lore_ui';
  END IF;
END$$;
