-- 0125_auto_merge_kpis_sc002: Compute SC-002 from actual dependency/merge evidence.
-- Emits exactly one row per merged PR (pr_merged only, so no double-counting).
-- SC-001: merged_without_human = TRUE when a lore_reviewer_approved event exists for the PR.
-- SC-002: dependent_merged_before_dependency = TRUE when a dependsOn task has a PR that
--         merged after the current PR (violation of dependency order).
-- SC-004: unchanged from 0108.

CREATE OR REPLACE VIEW pipeline.v_auto_merge_kpis AS
SELECT
  t.task_group_id,
  (a.payload->>'prNumber')::INT AS pr_number,
  -- SC-001: Lore automated review approved; no human reviewer needed
  EXISTS (
    SELECT 1 FROM pipeline.audit_log ap
    WHERE ap.event_type = 'lore_reviewer_approved'
      AND ap.repo = a.repo
      AND (ap.payload->>'prNumber')::INT = (a.payload->>'prNumber')::INT
  ) AS merged_without_human,
  -- SC-002: dependent PR merged before its dependency task's PR(s)
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(a.payload->'dependsOn', '[]'::jsonb)) AS dep(task_id)
    JOIN pipeline.audit_log dep_merge
      ON dep_merge.event_type = 'pr_merged'
     AND dep_merge.repo = a.repo
     AND dep_merge.task_id = dep.task_id::uuid
     AND (dep_merge.payload->>'mergedAt')::timestamptz > (a.payload->>'mergedAt')::timestamptz
  ) AS dependent_merged_before_dependency,
  -- SC-004: sensitive merge without a human code-owner approval
  (
    jsonb_array_length(COALESCE(a.payload->'sensitivePaths', '[]'::jsonb)) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(a.payload->'approvedBy', '[]'::jsonb)) AS approver(login)
      WHERE approver.login NOT LIKE '%[bot]'
    )
  ) AS sensitive_merged_without_codeowner,
  a.repo
FROM pipeline.audit_log a
LEFT JOIN pipeline.tasks t ON a.task_id = t.id
WHERE a.event_type = 'pr_merged';
