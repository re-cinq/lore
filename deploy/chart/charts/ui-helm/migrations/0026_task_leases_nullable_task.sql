-- Detection assembly lines (ADR-019 amendment) hold branch leases without a
-- backing pipeline task: the branch name detect/<definition>/<repo> is a pure
-- lease key. Allow NULL task_id; the FK still validates non-null values.
--
-- DBs bootstrapped before the dark-factory baseline (setup-dark-factory-schema.sh)
-- landed never got pipeline.task_leases: the baseline setup-*-schema.sh scripts run
-- once at cluster bootstrap, only migrations run every deploy. So the bare ALTER
-- below fails with "relation pipeline.task_leases does not exist" on those DBs and
-- wedges the whole pre-upgrade migration hook. Create the table here for them —
-- same reason 0014 backfills pipeline.audit_log, mirroring setup-dark-factory-schema.sh.
-- No-op where the baseline already created it. Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS pipeline.task_leases (
  branch_name   TEXT        PRIMARY KEY,
  task_id       UUID,
  holder        TEXT        NOT NULL,
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  phase         TEXT,
  CONSTRAINT task_leases_task_fk FOREIGN KEY (task_id)
    REFERENCES pipeline.tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS task_leases_expires_idx
  ON pipeline.task_leases(expires_at);

ALTER TABLE pipeline.task_leases ALTER COLUMN task_id DROP NOT NULL;
