-- 0025_assembly_lines: first-class identity for assembly line executions.
--
-- Until now an assembly line run had no id of its own: the task uuid was reused
-- everywhere, so two attempts of one task were indistinguishable, and node
-- executions were only traceable by parsing commit trailers or Agent CR names.
-- `pipeline.assembly_lines` gives every execution a per-attempt uuid (minted by
-- `project.assemblyLines.start()`, which also inserts the `assembly_line.start`
-- event in the same statement); `pipeline.assembly_line_nodes` traces each node
-- the executor visits.
--
-- The `task_id` FK assumes `pipeline.tasks` from the baseline setup scripts
-- (`setup-pipeline-schema.sh`) — true on both deploy paths (GKE Helm hook and
-- setup-local-schema.sh, which run the baseline first). Nullable: producers
-- other than the task pipeline can start assembly lines directly.

CREATE TABLE IF NOT EXISTS pipeline.assembly_lines (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_name TEXT         NOT NULL,
  task_id         UUID         REFERENCES pipeline.tasks(id) ON DELETE SET NULL,
  repo            TEXT         NOT NULL,
  branch          TEXT,
  args            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT         NOT NULL DEFAULT 'queued',  -- queued | running | finished | failed
  outcome         TEXT,        -- pr_created | no_changes | lease_held | iteration_max | error | ...
  reason          TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS assembly_lines_task_idx
  ON pipeline.assembly_lines(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assembly_lines_repo_idx
  ON pipeline.assembly_lines(repo, created_at DESC);
CREATE INDEX IF NOT EXISTS assembly_lines_status_idx
  ON pipeline.assembly_lines(status, created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline.assembly_line_nodes (
  id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assembly_line_id UUID         NOT NULL REFERENCES pipeline.assembly_lines(id) ON DELETE CASCADE,
  node_id          TEXT         NOT NULL,
  iteration        INT          NOT NULL DEFAULT 1,
  outcome          TEXT,
  agent_cr_name    TEXT,
  commit_sha       TEXT,
  started_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS assembly_line_nodes_al_idx
  ON pipeline.assembly_line_nodes(assembly_line_id, started_at);
