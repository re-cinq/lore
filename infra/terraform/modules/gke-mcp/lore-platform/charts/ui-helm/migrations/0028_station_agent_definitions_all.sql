-- 0028_station_agent_definitions_all.sql
--
-- Seed the remaining builtin station recipes (gate / retrospective /
-- github_action / detect) as org-default agent_definitions rows, completing the
-- set 0027 started with def-validate (ADR-031 amendment: every non-agent node
-- runs as a pod via the exec vendor). Names match nodeStationSpec's
-- `def-<node type>` resolution. Idempotent + non-destructive: inserts only when
-- the org row is absent, so a later /agents UI edit (or re-run) is never
-- clobbered. execution_mode 'station' marks the exec-vendor recipes; model stays
-- NULL (the vendor routing key lives in the materialized CRD).

INSERT INTO lore.agent_definitions (name, timeout_minutes, image, execution_mode, review_required)
SELECT v.name, v.timeout_minutes, 'ghcr.io/re-cinq/lore-station:latest', 'station', false
FROM (VALUES
  ('def-gate', 5),
  ('def-retrospective', 10),
  ('def-github_action', 60),
  ('def-detect', 30)
) AS v(name, timeout_minutes)
WHERE NOT EXISTS (
  SELECT 1 FROM lore.agent_definitions d
  WHERE d.name = v.name AND d.project_id IS NULL
);
