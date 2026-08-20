-- 0043_tasks_late_columns: backfill the pipeline.tasks columns that only ever
-- existed in a baseline setup-*.sh (the sibling of 0014, for the same reason).
--
-- Ten columns were added to pipeline.tasks by idempotent ALTERs inside the
-- baseline scripts — log_url, claimed_by, claimed_at, priority and
-- task_group_id in setup-pipeline-schema.sh; issue_number, issue_url and actor
-- in setup-agent-schema.sh; context_refs in setup-memory-schema.sh;
-- dark_factory_overrides in setup-dark-factory-schema.sh. Those scripts run ONCE
-- when an operator provisions a cluster, so a database bootstrapped before an
-- ALTER was appended never received it and nothing since would have added it.
--
-- That stayed invisible while every reader used `SELECT *`. It stopped being
-- invisible when the task queue began generating its SELECT list from the model
-- (#1410 put dark_factory_overrides in PIPELINE_TASK_COLUMNS, #1435 made
-- claimNextPending read through selectList): the Floor's worker then named a
-- column production did not have, threw 42703 on its first poll, and
-- crash-looped — taking /healthz down with it, wedging the umbrella rollout, and
-- failing every ci-ingest that needs a live Floor.
--
-- All ten are listed rather than only the one that surfaced. Postgres reports
-- the FIRST unknown column in a SELECT, so fixing one at a time discovers the
-- next by crashing production again. Every statement is ADD COLUMN IF NOT
-- EXISTS, so on a database that has them this file is a no-op.
--
-- Types mirror the baseline scripts exactly. Idempotent: safe to re-run.

ALTER TABLE pipeline.tasks
  ADD COLUMN IF NOT EXISTS log_url                TEXT,
  ADD COLUMN IF NOT EXISTS claimed_by             TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority               TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS task_group_id          UUID,
  ADD COLUMN IF NOT EXISTS issue_number           INTEGER,
  ADD COLUMN IF NOT EXISTS issue_url              TEXT,
  ADD COLUMN IF NOT EXISTS actor                  TEXT,
  ADD COLUMN IF NOT EXISTS context_refs           JSONB,
  ADD COLUMN IF NOT EXISTS dark_factory_overrides JSONB DEFAULT NULL;

-- The two partial indexes over those columns are declared in the same baseline
-- script and carry the same never-applied risk. Copied verbatim.
CREATE INDEX IF NOT EXISTS tasks_priority_idx
  ON pipeline.tasks (priority) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS tasks_group_idx
  ON pipeline.tasks (task_group_id) WHERE task_group_id IS NOT NULL;
