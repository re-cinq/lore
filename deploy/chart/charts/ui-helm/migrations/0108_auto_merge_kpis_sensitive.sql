-- 0108_auto_merge_kpis_sensitive: SC-004 reads the blocked-reason station's pr_merged rows (specs/protected-branch-merge).
-- A merge is sensitive without a code owner when CODEOWNERS owned a changed path and no approver was a person:
-- a login ending in [bot] is a GitHub App, which cannot be a code owner.
-- SC-002 stays FALSE until task dependencies reach the audit rows (#2709).
-- Same columns in the same order as 0106, so CREATE OR REPLACE keeps the view.

CREATE OR REPLACE VIEW pipeline.v_auto_merge_kpis AS
SELECT
  t.task_group_id,
  (a.payload->>'prNumber')::INT AS pr_number,
  -- SC-001
  (a.event_type = 'lore_reviewer_approved') AS merged_without_human,
  -- SC-002
  FALSE AS dependent_merged_before_dependency,
  -- SC-004
  (
    a.event_type = 'pr_merged'
    AND jsonb_array_length(COALESCE(a.payload->'sensitivePaths', '[]'::jsonb)) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(a.payload->'approvedBy', '[]'::jsonb)) AS approver(login)
      WHERE approver.login NOT LIKE '%[bot]'
    )
  ) AS sensitive_merged_without_codeowner,
  a.repo
FROM pipeline.audit_log a
LEFT JOIN pipeline.tasks t ON a.task_id = t.id
WHERE a.event_type IN ('lore_reviewer_approved', 'pr_merged');
