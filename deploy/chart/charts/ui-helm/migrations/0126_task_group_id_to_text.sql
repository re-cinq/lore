-- 0126_task_group_id_to_text: change pipeline.tasks.task_group_id from UUID to TEXT.
-- The TypeScript domain already treats taskGroupId as string; this aligns the column type.
-- Existing UUIDs cast implicitly. The partial btree index on the column is rebuilt automatically.
-- Drop the KPI view first because it references task_group_id; recreate after the type change.

DROP VIEW IF EXISTS pipeline.v_auto_merge_kpis;

ALTER TABLE pipeline.tasks
  ALTER COLUMN task_group_id TYPE TEXT USING task_group_id::text;

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
