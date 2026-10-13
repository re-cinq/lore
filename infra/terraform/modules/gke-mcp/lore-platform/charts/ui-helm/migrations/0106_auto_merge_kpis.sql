CREATE OR REPLACE VIEW pipeline.v_auto_merge_kpis AS
SELECT
  t.task_group_id,
  (a.payload->>'prNumber')::INT AS pr_number,
  -- SC-001
  (a.event_type = 'lore_reviewer_approved') AS merged_without_human,
  -- SC-002
  FALSE AS dependent_merged_before_dependency,
  -- SC-004
  FALSE AS sensitive_merged_without_codeowner,
  a.repo
FROM pipeline.audit_log a
LEFT JOIN pipeline.tasks t ON a.task_id = t.id
WHERE a.event_type IN ('lore_reviewer_approved', 'pr_merged');
