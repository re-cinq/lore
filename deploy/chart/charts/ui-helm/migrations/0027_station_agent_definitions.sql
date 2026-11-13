-- 0027_station_agent_definitions.sql
--
-- Seed the builtin station recipes (ADR-031 amendment: non-agent assembly-line
-- nodes run as pods via the exec vendor) as org-default agent_definitions rows,
-- so image + timeout are operator-editable in the /agents UI and per-repo
-- overridable — with image changes riding the existing two-key gate. The name
-- matches the catalog's `def-<node type>` convention nodeStationSpec resolves.
-- Phase 1 ships validate; later phases append their own rows.
--
-- Idempotent + non-destructive: inserts only when the org row is absent, so a
-- later UI edit (or re-run) is never clobbered. execution_mode 'station' marks
-- the row as an exec-vendor recipe (no LLM); model stays NULL — the vendor
-- routing key lives in the materialized CRD, not here.

INSERT INTO lore.agent_definitions (name, timeout_minutes, image, execution_mode, review_required)
SELECT 'def-validate', 15, 'ghcr.io/re-cinq/lore-station:latest', 'station', false
WHERE NOT EXISTS (
  SELECT 1 FROM lore.agent_definitions
  WHERE name = 'def-validate' AND project_id IS NULL
);
