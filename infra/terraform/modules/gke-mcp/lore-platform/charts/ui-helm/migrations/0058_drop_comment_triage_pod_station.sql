-- 0058_drop_comment_triage_pod_station: comment-triage no longer runs in a pod.
--
-- The station's manifest flipped to runtime "service": the walk publishes the
-- node to the pooled stations service, which makes the one enum-constrained
-- Haiku classification in-process. The pod recipe migration 0030 seeded
-- (`def-comment-triage`, exec-vendor `lore-station comment-triage`) has no
-- dispatcher left — one Kubernetes Job per PR comment cost 527 pods and 164
-- pod-hours in a month to deliver $0.20 of model work — so the org-default row
-- goes, exactly as 0055 removed def-github_action. Per-project overrides (if
-- anyone made one) are left alone: they were a human's edit, not our seed.
--
-- The catalog event rides in the same statement, as the app's own writes do,
-- so every registered cluster-agent hears the delete and reaps the CR pair.

WITH removed AS (
  DELETE FROM lore.agent_definitions
   WHERE name = 'def-comment-triage'
     AND project_id IS NULL
  RETURNING name, project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT name, project_id, 'delete' FROM removed;
