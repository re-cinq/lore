-- 0040_assembly_runs: name the runtime model for what it is, and give a run its
-- own copy of the blueprint it runs (specs/6-dark-factory FR6.38–FR6.41,
-- ADR-024 amendment 2026-08-14).
--
-- `pipeline.assembly_lines` never held assembly lines. It held one EXECUTION of
-- one — the blueprint lives in YAML — so the word meant both things and the
-- schema could not tell them apart. This renames the runtime side:
--
--   pipeline.assembly_lines      -> pipeline.assembly_runs
--   pipeline.assembly_line_nodes -> pipeline.station_runs
--   *.assembly_line_id           -> *.assembly_run_id
--   assembly_runs.definition_*   -> assembly_runs.blueprint_*
--
-- RENAME, not create-and-backfill: a rename is metadata-only, so it copies no
-- rows, keeps every index, constraint, sequence and grant attached, and cannot
-- half-succeed on a large table. The blueprint side keeps its old names
-- (libs/assembly-lines, the YAMLs, the loader) because that is now all they mean.
--
-- graph JSONB — the CLONE. `project.assemblyRuns.start()` snapshots the resolved
-- definition graph (nodes, edges, and each node's ALREADY-RESOLVED Station) onto
-- the row, and the walk reads that instead of re-reading the YAML off the Floor's
-- image at every step. Nullable on purpose: rows that predate this column carry
-- no clone and fall back to resolving by name, exactly as they do today. A run
-- that already exists must stay inspectable.
--
-- station_runs.station_run_id — the identity a station visit never had. Telemetry
-- correlated by matching `agent_cr_name`, a string built from a 12-hex prefix of
-- the run id, through a join whose tie-break was "newest matching row wins"; two
-- runs colliding on that prefix silently attributed one's tool calls to the
-- other. The bigint `id` STAYS as the visit order the replay depends on — a v4
-- uuid does not sort, and `listStationRuns` returning rows out of visit order
-- would reorder the walk's own history. Postgres 18's `uuidv7()` would collapse
-- the two into one column; lore-db runs 16.
--
-- COMPAT VIEWS. The Helm hook runs pre-upgrade, so pods running the PREVIOUS
-- image briefly see this schema. Views carrying the old names and the old column
-- names keep those pods working through that window — reads AND writes. They are
-- deliberately not a long-term shim: a later migration drops them once no caller
-- uses the old names.
--
-- The views are auto-updatable (a plain SELECT of base columns from a single
-- table), so an old pod's INSERT/UPDATE still lands. `ON CONFLICT`, including the
-- `DO UPDATE` form, resolves its inference against the base table's index through
-- the view — verified, not assumed. The one real trap is `xmax`: the node insert
-- returns `(xmax = 0) AS created` to tell a fresh insert from a converged
-- duplicate, and a view exposes NO system columns unless they are selected by
-- name. `assembly_line_nodes` therefore selects `xmax` explicitly, which makes
-- the old write path work verbatim. Without that one column the statement fails
-- with `column "xmax" does not exist` for the whole rollout.
--
-- The telemetry tables get no views. Their writes are already skip-not-fail and
-- FK-free by design (0031, 0037), so a couple of minutes of best-effort
-- tool-call rows is a smaller price than a permanently half-renamed schema.
--
-- ADD COLUMN with a volatile DEFAULT (gen_random_uuid()) REWRITES station_runs
-- under an ACCESS EXCLUSIVE lock — the table is small today and the hook runs at
-- deploy time, so this is acceptable here, exactly as 0031 documents for its
-- non-concurrent index. Anyone applying this to a materially larger deployment
-- should add the column nullable, backfill in batches, and set the default after.
--
-- Idempotent: every rename is guarded on the catalog, so re-running is a no-op.
-- The guards read pg_tables / information_schema.columns, which list TABLES only
-- — a compat view named `assembly_lines` therefore never makes a guard think the
-- rename has not happened yet.

-- ---------------------------------------------------------------- tables

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables
              WHERE schemaname = 'pipeline' AND tablename = 'assembly_lines')
     AND NOT EXISTS (SELECT 1 FROM pg_tables
                      WHERE schemaname = 'pipeline' AND tablename = 'assembly_runs')
  THEN
    ALTER TABLE pipeline.assembly_lines RENAME TO assembly_runs;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables
              WHERE schemaname = 'pipeline' AND tablename = 'assembly_line_nodes')
     AND NOT EXISTS (SELECT 1 FROM pg_tables
                      WHERE schemaname = 'pipeline' AND tablename = 'station_runs')
  THEN
    ALTER TABLE pipeline.assembly_line_nodes RENAME TO station_runs;
  END IF;
END $$;

-- ---------------------------------------------------------------- columns

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pipeline' AND table_name = 'station_runs'
                AND column_name = 'assembly_line_id')
  THEN
    ALTER TABLE pipeline.station_runs RENAME COLUMN assembly_line_id TO assembly_run_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pipeline' AND table_name = 'assembly_runs'
                AND column_name = 'definition_name')
  THEN
    ALTER TABLE pipeline.assembly_runs RENAME COLUMN definition_name TO blueprint_name;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pipeline' AND table_name = 'assembly_runs'
                AND column_name = 'definition_hash')
  THEN
    ALTER TABLE pipeline.assembly_runs RENAME COLUMN definition_hash TO blueprint_hash;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pipeline' AND table_name = 'assembly_runs'
                AND column_name = 'resumed_from_line_id')
  THEN
    ALTER TABLE pipeline.assembly_runs RENAME COLUMN resumed_from_line_id TO resumed_from_run_id;
  END IF;
END $$;

-- The telemetry + cost tables point AT a run; rename their pointer to match.
DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['agent_run_events', 'agent_run_turns', 'llm_calls'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'pipeline' AND table_name = target
                  AND column_name = 'assembly_line_id')
    THEN
      EXECUTE format(
        'ALTER TABLE pipeline.%I RENAME COLUMN assembly_line_id TO assembly_run_id',
        target);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- new columns

ALTER TABLE pipeline.assembly_runs
  ADD COLUMN IF NOT EXISTS graph JSONB;

ALTER TABLE pipeline.station_runs
  ADD COLUMN IF NOT EXISTS station_run_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS station_runs_station_run_id_uniq
  ON pipeline.station_runs(station_run_id);

-- The correlation key telemetry keys on from now on. Nullable and FK-free, for
-- the reasons 0031 and 0037 give at length: ingest is a batch insert and one
-- unresolvable row must never abort the batch.
ALTER TABLE pipeline.agent_run_events
  ADD COLUMN IF NOT EXISTS station_run_id UUID;

ALTER TABLE pipeline.agent_run_turns
  ADD COLUMN IF NOT EXISTS station_run_id UUID;

ALTER TABLE pipeline.llm_calls
  ADD COLUMN IF NOT EXISTS station_run_id UUID;

-- ---------------------------------------------------------------- indexes

-- A rename leaves index names pointing at the old vocabulary; a schema that is
-- half-renamed reads as a migration someone abandoned.
ALTER INDEX IF EXISTS pipeline.assembly_lines_task_idx        RENAME TO assembly_runs_task_idx;
ALTER INDEX IF EXISTS pipeline.assembly_lines_repo_idx        RENAME TO assembly_runs_repo_idx;
ALTER INDEX IF EXISTS pipeline.assembly_lines_status_idx      RENAME TO assembly_runs_status_idx;
ALTER INDEX IF EXISTS pipeline.idx_assembly_lines_resumed_from RENAME TO idx_assembly_runs_resumed_from;
ALTER INDEX IF EXISTS pipeline.assembly_line_nodes_al_idx     RENAME TO station_runs_run_idx;
ALTER INDEX IF EXISTS pipeline.assembly_line_nodes_attempt_uniq RENAME TO station_runs_attempt_uniq;
ALTER INDEX IF EXISTS pipeline.assembly_line_nodes_cr_name_idx RENAME TO station_runs_cr_name_idx;
ALTER INDEX IF EXISTS pipeline.agent_run_events_line_idx      RENAME TO agent_run_events_run_idx;
ALTER INDEX IF EXISTS pipeline.agent_run_turns_line_idx       RENAME TO agent_run_turns_run_idx;

-- Runs are browsed BY BLUEPRINT ("every code-review run") and by repo+blueprint.
-- The 0025 indexes cover repo, status and task; nothing covered the blueprint,
-- so that listing was a sequential scan waiting to be noticed.
CREATE INDEX IF NOT EXISTS assembly_runs_blueprint_idx
  ON pipeline.assembly_runs(blueprint_name, created_at DESC);

CREATE INDEX IF NOT EXISTS assembly_runs_repo_blueprint_idx
  ON pipeline.assembly_runs(repo, blueprint_name, created_at DESC);

-- ---------------------------------------------------------------- compat views

CREATE OR REPLACE VIEW pipeline.assembly_lines AS
  SELECT id,
         blueprint_name       AS definition_name,
         blueprint_hash       AS definition_hash,
         task_id,
         repo,
         branch,
         args,
         status,
         outcome,
         reason,
         resumed_from_run_id  AS resumed_from_line_id,
         resumed_from_node_id,
         inherited_node_count,
         created_at,
         started_at,
         finished_at
    FROM pipeline.assembly_runs;

CREATE OR REPLACE VIEW pipeline.assembly_line_nodes AS
  SELECT id,
         -- Load-bearing: `ensureNodeStart` returns `(xmax = 0) AS created`, and a
         -- view exposes no system column unless it is named here. Dropping this
         -- breaks every node insert from a pre-rename pod.
         xmax,
         assembly_run_id AS assembly_line_id,
         node_id,
         iteration,
         outcome,
         agent_cr_name,
         commit_sha,
         started_at,
         finished_at
    FROM pipeline.station_runs;

-- Grants: a rename carries the base tables' ACLs, but the new views need their
-- own. Guarded on the role existing, like 0009/0017/0031, so this migration
-- never fails on a cluster that connects the web UI as `lore`.
GRANT ALL ON pipeline.assembly_lines      TO lore;
GRANT ALL ON pipeline.assembly_line_nodes TO lore;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lore_ui') THEN
    GRANT SELECT ON pipeline.assembly_lines      TO lore_ui;
    GRANT SELECT ON pipeline.assembly_line_nodes TO lore_ui;
  END IF;
END $$;
