-- 0030_seed_comment_triage_station.sql
--
-- Seed the comment-triage builtin station recipe as an org-default
-- agent_definitions row (ADR-012 amendment: PR comments are classified by a cheap
-- Haiku station that routes review / address / answer / ignore). Name matches
-- nodeStationSpec's `def-<node type>` resolution (`comment-triage` → def-comment-triage).
-- Idempotent + non-destructive: inserts only when the org row is absent, so a
-- later /agents UI edit (or re-run) is never clobbered. execution_mode 'station'
-- marks the exec-vendor recipe; model stays NULL (the pod calls Haiku itself).

INSERT INTO lore.agent_definitions (name, timeout_minutes, image, execution_mode, review_required)
SELECT 'def-comment-triage', 5, 'ghcr.io/re-cinq/lore-station:latest', 'station', false
WHERE NOT EXISTS (
  SELECT 1 FROM lore.agent_definitions d
  WHERE d.name = 'def-comment-triage' AND d.project_id IS NULL
);
